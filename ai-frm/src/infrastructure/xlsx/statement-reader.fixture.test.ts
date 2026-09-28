/**
 * 실물 자금수지표로 도는 통합 검증.
 *
 * fixture는 사내 자금 데이터라 커밋하지 않는다(.gitignore). 파일이 없으면
 * 통째로 건너뛰므로 새로 클론한 곳이나 CI에서 깨지지 않는다.
 *
 * 단언에 쓰는 169%는 회의록에 이미 적힌 값이다.
 * 파일을 두려면: ai-frm/fixtures/자금수지표-최신회차.xlsx
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readStatement } from '@/infrastructure/xlsx/statement-reader';
import { assessLiquidityGap, liquidityGapInputFrom } from '@/domain/risk/liquidity-gap/liquidity-gap';
import { calendarOf, checkRollForward, type Statement } from '@/domain/cashflow/statement';
import { adequateCashAt } from '@/domain/risk/adequate-cash/adequate-cash';
import { toPercent } from '@/domain/shared/amount';

const FIXTURE = resolve(process.cwd(), 'fixtures/자금수지표-최신회차.xlsx');
const present = existsSync(FIXTURE);

describe.skipIf(!present)('실물 회차 판독', () => {
  let statement: Statement;

  // 파일이 커서 한 번만 읽고 돌려쓴다.
  beforeAll(() => {
    const file = readFileSync(FIXTURE);
    const data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
    const result = readStatement(data);
    if (!result.ok) throw new Error(result.error);
    statement = result.statement;
  }, 30_000);

  it('시트를 찾고 회차를 만든다', () => {
    expect(statement.months.length).toBeGreaterThan(0);
  });

  it('소계 열을 걸러 내고 월만 남긴다', () => {
    const labels = statement.months.map((m) => m.label);
    expect(labels).not.toContain('상반기계');
    expect(labels).not.toContain('하반기계');
    expect(labels.slice(0, 3)).toEqual(['1월', '2월', '3월']);
  });

  it('기준일에서 기준월을 8월로 잡는다', () => {
    expect(statement.asOf.getFullYear()).toBe(2026);
    expect(statement.defaultBaseMonth.label).toBe('8월');
  });

  it('기준월의 달력 월은 2026/08이고, 12월 다음 열은 라벨과 달리 2027/01이다', () => {
    expect(calendarOf(statement, statement.defaultBaseMonth)).toBe('2026/08');
    const december = statement.months.find((m) => m.label === '12월');
    if (december === undefined) throw new Error('12월 열이 없습니다.');
    expect(calendarOf(statement, statement.months[december.index + 1])).toBe('2027/01');
  });

  it('회의록의 169%가 재현된다 — 이 구현 전체의 회귀 기준점', () => {
    const gap = assessLiquidityGap(liquidityGapInputFrom(statement, statement.defaultBaseMonth));
    expect(gap.kind).toBe('gap');
    if (gap.kind !== 'gap') return;
    expect(Math.round(toPercent(gap.gapRatio) * 10) / 10).toBe(169.0);
    expect(gap.grade).toBe('정상');
  });

  it('시재 롤포워드가 전 구간 들어맞는다 — 판독이 행을 제대로 잡았다는 뜻이다', () => {
    expect(checkRollForward(statement)).toEqual([]);
  });

  it('수입계를 수입으로 착각하지 않는다 — 착각하면 Gap이 351%로 부풀어 오른다', () => {
    const august = statement.defaultBaseMonth;
    expect(statement.amountOf('수입계', august)).toBeGreaterThan(statement.amountOf('수입', august));
  });

  it('분양회수는 수입의 일부다 — 대금 회수 위험이 읽는 항목', () => {
    const august = statement.defaultBaseMonth;
    const 분양회수 = statement.amountOf('분양회수', august);
    const 수입 = statement.amountOf('수입', august);

    // 수입 = 정부출자금 + 국고보조금 + 국민주택기금 + 공공분양자금 + 분양회수 + 기타수입.
    // 분양회수만 떼어 쓰므로 반드시 더 작아야 하고, 0이어서도 안 된다.
    expect(분양회수).toBeGreaterThan(0);
    expect(분양회수).toBeLessThan(수입);
  });

  it('모든 항목을 읽는다 — 기타수입도 이웃 행과 헷갈리지 않는다', () => {
    expect(statement.unreadableItems()).toEqual([]);
    const august = statement.defaultBaseMonth;
    // 분양회수 + 기타수입은 수입의 일부다.
    expect(statement.amountOf('분양회수', august) + statement.amountOf('기타수입', august)).toBeLessThan(
      statement.amountOf('수입', august),
    );
  });

  it('계획연도 끝은 12월이다', () => {
    expect(statement.planYearEnd.label).toBe('12월');
  });

  // 금액은 단언하지 않는다(사내 자금 데이터). 판정과 표시만 본다.
  // 금액은 2026-09-28 자금기획팀 엑셀 산출값과 수기 대조해 일치를 확인했다(PRD §9-5).
  it('적정 시재 — 8월 기준 한 달치, 안정적, 계획·다음 해 표시 없음, 등급 없음', () => {
    const august = adequateCashAt(statement, statement.defaultBaseMonth);
    expect(august).toMatchObject({
      month: { label: '8월' },
      windowEnd: { label: '10월' },
      isAdequate: true,
      isPlan: false,
      beyondPlanYear: false,
    });
    expect(august).not.toHaveProperty('grade');
  });
});
