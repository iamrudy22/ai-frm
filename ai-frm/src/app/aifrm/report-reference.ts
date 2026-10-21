/** 최신 업로드 한 파일의 월별 금액. 18열 절단은 표시 정책이며 원본 계열은 보존한다. */

import {
  beyondPlanYearOf,
  calendarOf,
  natureOf,
  type CashflowNature,
} from '@/domain/cashflow/statement';
import type { Amount } from '@/domain/shared/amount';
import type { YearMonth } from '@/domain/shared/year-month';
import type { UploadedRound } from './uploaded-rounds';

export type ReferenceItem = '분양회수' | '수입' | '지출' | '기초시재';
export type ReferenceChartId = 'sales-recovery' | 'income-expense' | 'opening-cash';

export type OmittedRange = {
  readonly from: YearMonth;
  readonly to: YearMonth;
  readonly count: number;
};

export type ReferencePoint = {
  readonly month: YearMonth;
  readonly nature: CashflowNature;
  readonly beyondPlanYear: boolean;
  readonly source: {
    readonly file: string;
    readonly round: YearMonth;
    readonly item: ReferenceItem;
    /** 소계 제거 후 월 순번. 실제 엑셀 열 번호나 셀 주소가 아니다. */
    readonly statementMonthIndex: number;
    readonly monthLabel: string;
  };
} & (
  | { readonly kind: 'available'; readonly value: Amount }
  | { readonly kind: 'missing'; readonly value: null; readonly reason: string }
);

export type StatementReferenceTrends = {
  readonly sourceRound: YearMonth;
  readonly sourceFile: string;
  readonly unit: '억원';
  readonly window: {
    readonly from: YearMonth;
    readonly to: YearMonth;
    readonly omittedBefore: OmittedRange | null;
    readonly omittedAfter: OmittedRange | null;
  };
  readonly charts: readonly {
    readonly id: ReferenceChartId;
    readonly series: readonly {
      readonly item: ReferenceItem;
      readonly points: readonly ReferencePoint[];
    }[];
  }[];
  readonly note: string;
};

const MAX_MONTHS = 18;
const CHARTS: readonly { readonly id: ReferenceChartId; readonly items: readonly ReferenceItem[] }[] = [
  { id: 'sales-recovery', items: ['분양회수'] },
  { id: 'income-expense', items: ['수입', '지출'] },
  { id: 'opening-cash', items: ['기초시재'] },
];

export function buildStatementReferenceTrends(latest: UploadedRound | null): StatementReferenceTrends | null {
  if (latest === null) return null;
  const { statement, file, round } = latest;
  const start = Math.max(0, statement.defaultBaseMonth.index - (MAX_MONTHS - 1));
  const endExclusive = Math.min(statement.months.length, start + MAX_MONTHS);
  const months = statement.months.slice(start, endExclusive);
  const unreadable = new Map(statement.unreadableItems().map(({ item, reason }) => [item, reason]));

  const omittedRange = (from: number, toExclusive: number): OmittedRange | null => from === toExclusive ? null : {
    from: calendarOf(statement, statement.months[from]),
    to: calendarOf(statement, statement.months[toExclusive - 1]),
    count: toExclusive - from,
  };

  return {
    sourceRound: round,
    sourceFile: file,
    unit: '억원',
    window: {
      from: calendarOf(statement, months[0]),
      to: calendarOf(statement, months[months.length - 1]),
      omittedBefore: omittedRange(0, start),
      omittedAfter: omittedRange(endExclusive, statement.months.length),
    },
    charts: CHARTS.map(({ id, items }) => ({
      id,
      series: items.map((item) => ({
        item,
        points: months.map((month): ReferencePoint => {
          const point = {
            month: calendarOf(statement, month),
            nature: natureOf(statement, item, month),
            beyondPlanYear: beyondPlanYearOf(statement, month),
            source: { file, round, item, statementMonthIndex: month.index, monthLabel: month.label },
          };
          const reason = unreadable.get(item);
          return reason === undefined
            ? { ...point, kind: 'available', value: statement.amountOf(item, month) }
            : { ...point, kind: 'missing', value: null, reason };
        }),
      })),
    })),
    note: '최신 회차에 기재된 월별 금액이며, 회차별 당시 위험지표 이력과 기준이 다릅니다.',
  };
}
