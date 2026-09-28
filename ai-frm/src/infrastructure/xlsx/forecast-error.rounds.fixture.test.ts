/**
 * 분양회수 예측오차 — 자금기획팀 정의(정책 §3-2)를 실제 회차 파일로 확인한다.
 *
 *   7월 = (7월 회차의 4·5·6월 실적 − 5월 회차의 6·7·8월 계획) ÷ 5월 회차의 5·6·7월 계획
 *
 * 기대값 +36.06%는 판독 계층·이력·산식을 거치지 않고, 두 회차 파일의 분양회수 칸을
 * 직접 읽어 계산한 값이다(2026-09-28, 작업 계획 §0-1). 이 테스트는 시스템이 같은
 * 값을 내는지 본다.
 *
 * 사내 자금 데이터라 커밋하지 않는다. 폴더가 없으면 건너뛴다.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { emptyLedger, type ForecastLedger } from '@/domain/cashflow/forecast-ledger';
import { roundEntryOf } from '@/domain/cashflow/round-entry';
import { isMissing } from '@/domain/risk/construction-perception/construction-perception';
import { forecastErrorAt } from '@/domain/risk/construction-perception/forecast-error';
import { parseYearMonth } from '@/domain/shared/year-month';
import { readStatement } from '@/infrastructure/xlsx/statement-reader';

const DIR = resolve(process.cwd(), 'fixtures/자금수지표');
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.xlsx')) : [];

describe.skipIf(files.length < 8)('분양회수 예측오차 — 2026년 1~8월 회차', () => {
  let ledger: ForecastLedger;

  beforeAll(() => {
    ledger = files.reduce((l, file) => {
      const data = readFileSync(resolve(DIR, file));
      const result = readStatement(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
      if (!result.ok) throw new Error(`${file}: ${result.error}`);
      return l.record(roundEntryOf(result.statement));
    }, emptyLedger());
  }, 120_000);

  it('여덟 회차가 이력에 들어간다', () => {
    expect(ledger.rounds()).toEqual([
      '2026/01', '2026/02', '2026/03', '2026/04', '2026/05', '2026/06', '2026/07', '2026/08',
    ]);
  });

  it('7월 오차율이 두 파일을 직접 읽어 계산한 +36.06%와 같다', () => {
    const r = forecastErrorAt(ledger, parseYearMonth('2026/07'));
    if (isMissing(r)) throw new Error(r.missing);
    expect(r).toBeCloseTo(0.360561, 5);
  });

  it('4~8월은 산출된다 — t월 회차와 t−2월 회차가 모두 있다', () => {
    for (const month of ['2026/04', '2026/05', '2026/06', '2026/07', '2026/08']) {
      expect(isMissing(forecastErrorAt(ledger, parseYearMonth(month))), month).toBe(false);
    }
  });

  // 1~3월은 전년 10~12월 실적이 필요한데, 2026년 회차 시트에는 전년 열이 없다.
  it('1~3월은 전년도 파일이 올라올 때까지 산출불가이고, 그렇게 알린다', () => {
    for (const month of ['2026/01', '2026/02', '2026/03']) {
      const r = forecastErrorAt(ledger, parseYearMonth(month));
      expect(isMissing(r) && r.missing, month).toMatch(/전년도 파일|회차가 이력에 없습니다/);
    }
  });
});
