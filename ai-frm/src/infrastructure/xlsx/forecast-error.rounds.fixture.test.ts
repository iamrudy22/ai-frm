/**
 * 분양회수 예측오차 — 실제 회차 파일로 계산한 값(정책 §3-2, 2026-09-28 재개정).
 *
 *   8월 = (8월 회차의 5·6·7월 실적 − 5월 회차 5·6·7월 계획) ÷ 같은 계획
 *   창은 엑셀 분양회수data "2026/08" 행(G열 식)과 같다.
 *
 * 값은 엑셀 H열과 조금 다르다. 엑셀 C열은 각 달 실적을 그 달 직후 회차에서 적어 두고
 * 고치지 않지만, 여기서는 t월 회차 한 장에 적힌(뒤에 고쳐진) 값을 쓰기 때문이다.
 * 창이 엑셀과 같다는 것은 실적을 직후 회차에서 읽어 넣으면 H열과 0.003%p 안에서
 * 같아지는 것으로 확인한다(엑셀 실적 칸은 반올림되어 있다. 예: 12,129.12 → 12,129).
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
import { forecastErrorAt, forecastErrorForBaseMonth } from '@/domain/risk/construction-perception/forecast-error';
import { addMonths, parseYearMonth } from '@/domain/shared/year-month';
import { readStatement } from '@/infrastructure/xlsx/statement-reader';

const DIR = resolve(process.cwd(), 'fixtures/자금수지표');
const EXCEL = resolve(process.cwd(), 'fixtures/분양회수-오차율-엑셀.csv');
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.xlsx')) : [];

const percent = (r: number) => Math.round(r * 10000) / 100;

describe.skipIf(files.length < 8 || !existsSync(EXCEL))('분양회수 예측오차 — 2026년 1~8월 회차', () => {
  let ledger: ForecastLedger;
  let excelRow: (label: string) => number;

  /** 이력에서 고른 회차만 담은 이력. */
  const only = (...rounds: string[]) =>
    rounds.reduce(
      (l, r) => l.record(ledger.entryOf(parseYearMonth(r)) as NonNullable<ReturnType<ForecastLedger['entryOf']>>),
      emptyLedger(),
    );

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

  it.each([
    ['2026/04', 41.68],
    ['2026/05', 45.9],
    ['2026/06', 26.07],
    ['2026/07', 13.84],
    ['2026/08', 23.35],
  ])('%s 오차율은 %s퍼센트 — 그 달 회차 한 장의 실적과 석 달 전 회차 계획', (month, expected) => {
    const t = parseYearMonth(month);
    const r = forecastErrorAt(only(addMonths(t, -3), t), t);
    expect(isMissing(r) ? r : percent(r)).toBe(expected);
  });

  // 엑셀 C열처럼 각 달 실적을 그 달 직후 회차에서 읽으면 H열과 같다 — 창(G열 식)이 같다는 뜻이다.
  it.each(['2026/04', '2026/05', '2026/06', '2026/07', '2026/08'])(
    '%s 창은 엑셀 분양회수data 같은 라벨 행과 같다 — 실적만 직후 회차 값으로 바꾸면 H열과 차이 0.00003 미만',
    (month) => {
      const t = parseYearMonth(month);
      const planRound = addMonths(t, -3);
      const plans = ledger.planOf(planRound);
      if (plans === undefined) throw new Error(`${planRound} 회차가 없습니다`);
      let actual = 0;
      let planned = 0;
      for (let i = 0; i < 3; i++) {
        const cell = plans[i];
        if ('missing' in cell) throw new Error(cell.missing);
        planned += cell.value;
        const value = ledger.actualOf(addMonths(cell.month, 1), cell.month);
        if (typeof value !== 'number') throw new Error(value.missing);
        actual += value;
      }
      expect(Math.abs((actual - planned) / planned - excelRow(month))).toBeLessThan(0.00003);
    },
  );

  // 7월 기준(기준월 5월)은 7월 회차 실적, 8월 기준(기준월 6월)은 8월 회차 실적.
  it.each([
    ['2026/05', '2026/07'],
    ['2026/06', '2026/08'],
  ])('기준월 %s 지수는 %s 라벨 오차율을 쓴다', (base, label) => {
    expect(forecastErrorForBaseMonth(ledger, parseYearMonth(base))).toBe(forecastErrorAt(ledger, parseYearMonth(label)));
  });

  it('8월 기준: 5·8월 회차 두 개만으로 기준월 6월 오차율이 나온다 — 23.35%(엑셀 24.11%)', () => {
    const r = forecastErrorForBaseMonth(only('2026/05', '2026/08'), parseYearMonth('2026/06'));
    expect(isMissing(r) ? r : percent(r)).toBe(23.35);
  });

  // 1~3월은 계획을 세운 전년 10~12월 회차가 필요하다(전년도 파일).
  it('1~3월은 전년도 회차를 올릴 때까지 산출불가이고, 그렇게 알린다', () => {
    for (const month of ['2026/01', '2026/02', '2026/03']) {
      const r = forecastErrorAt(ledger, parseYearMonth(month));
      expect(isMissing(r) && r.missing, month).toMatch(/2025\/1[0-2] 회차를 올리지 않았습니다/);
    }
  });
});
