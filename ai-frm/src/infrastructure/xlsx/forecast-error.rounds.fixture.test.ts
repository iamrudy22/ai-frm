/**
 * 분양회수 예측오차 — 실제 회차 파일로 계산한 값이 엑셀 분양회수data와 같은가
 * (정책 §3-2, 2026-09-28 재개정).
 *
 *   7월 = (4·5·6월 실적 − 4월 회차 4·5·6월 계획) ÷ 같은 계획 = 엑셀 "2026/07" 행
 *   실적은 각 달의 직후 회차 값이다.
 *
 * 엑셀 실적 칸은 반올림되어 들어가 있어(예: 12,129.12 → 12,129) 0.003%p 안에서 같다.
 *
 * 사내 자금 데이터라 커밋하지 않는다. 파일이 없으면 건너뛴다.
 * - 회차: fixtures/자금수지표/2026년 N,N+1,N+2월 계획*.xlsx
 * - 엑셀 오차율: node scripts/extract-perception-fixtures.mjs 로 만든
 *   fixtures/분양회수-오차율-엑셀.csv. 라벨을 한 달 당겨 저장했으므로(정책 §7 D8)
 *   엑셀 "2026/07" 행은 이 파일의 2026/06 줄이다.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { emptyLedger, type ForecastLedger } from '@/domain/cashflow/forecast-ledger';
import { roundEntryOf } from '@/domain/cashflow/round-entry';
import { isMissing } from '@/domain/risk/construction-perception/construction-perception';
import { forecastErrorAt } from '@/domain/risk/construction-perception/forecast-error';
import { addMonths, parseYearMonth } from '@/domain/shared/year-month';
import { readStatement } from '@/infrastructure/xlsx/statement-reader';

const DIR = resolve(process.cwd(), 'fixtures/자금수지표');
const EXCEL = resolve(process.cwd(), 'fixtures/분양회수-오차율-엑셀.csv');
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.xlsx')) : [];

describe.skipIf(files.length < 8 || !existsSync(EXCEL))('분양회수 예측오차 — 2026년 1~8월 회차 대 엑셀', () => {
  let ledger: ForecastLedger;
  let excelRow: (label: string) => number;

  beforeAll(() => {
    ledger = files.reduce((l, file) => {
      const data = readFileSync(resolve(DIR, file));
      const result = readStatement(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
      if (!result.ok) throw new Error(`${file}: ${result.error}`);
      return l.record(roundEntryOf(result.statement));
    }, emptyLedger());

    const [, ...lines] = readFileSync(EXCEL, 'utf8').trim().split(/\r?\n/);
    const byMonth = new Map(lines.map((line) => line.split(',')).map(([m, v]) => [m, Number(v)]));
    // 엑셀 라벨 L 행 = 이 파일의 L − 1 줄
    excelRow = (label) => byMonth.get(addMonths(parseYearMonth(label), -1)) as number;
  }, 120_000);

  it('여덟 회차가 이력에 들어간다', () => {
    expect(ledger.rounds()).toEqual([
      '2026/01', '2026/02', '2026/03', '2026/04', '2026/05', '2026/06', '2026/07', '2026/08',
    ]);
  });

  it.each(['2026/04', '2026/05', '2026/06', '2026/07', '2026/08'])(
    '%s 오차율이 엑셀 분양회수data 같은 라벨 행과 0.003%%p 안에서 같다',
    (month) => {
      const r = forecastErrorAt(ledger, parseYearMonth(month));
      if (isMissing(r)) throw new Error(r.missing);
      expect(Math.abs(r - excelRow(month))).toBeLessThan(0.00003);
    },
  );

  it('7월은 11.35%다 (이미지의 "2026/07" 행)', () => {
    const r = forecastErrorAt(ledger, parseYearMonth('2026/07'));
    expect(isMissing(r) ? r : Math.round(r * 10000) / 100).toBe(11.35);
  });

  // 1~3월은 계획을 세운 전년 10~12월 회차가 필요하다(전년도 파일).
  it('1~3월은 전년도 회차를 올릴 때까지 산출불가이고, 그렇게 알린다', () => {
    for (const month of ['2026/01', '2026/02', '2026/03']) {
      const r = forecastErrorAt(ledger, parseYearMonth(month));
      expect(isMissing(r) && r.missing, month).toMatch(/2025\/1[0-2] 회차를 올리지 않았습니다/);
    }
  });
});
