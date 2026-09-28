/**
 * 엑셀 동등성 — 엑셀 원값과 엑셀 분양회수 오차율을 넣으면 엑셀과 같은 지수·단계가
 * 나오는가. ECOS 9종의 변화율·점수와 가중합·단계 판정(산식)을 검증한다.
 *
 * 2026-09-28 개정: 분양회수 예측오차는 자금기획팀 정의로 바뀌어(정책 §3-2) 엑셀과
 * 다른 값이 나온다. 그래서 여기서는 엑셀의 오차율(라벨 보정)을 **그대로 주입**한다.
 * 새 정의의 오차율은 forecast-error.rounds.fixture.test.ts가 회차 파일로 검증한다.
 *
 * fixture는 사내 데이터라 커밋하지 않는다. 없으면 통째로 건너뛴다.
 * 만드는 법: node scripts/extract-perception-fixtures.mjs "<3. 건설경기인식지수(2026).xlsx>"
 * 그리고 인계 폴더의 fixture_expected.csv를 fixtures/건설경기인식지수-기대값.csv로 둔다.
 *
 * 단언과 로그에는 사내 금액을 쓰지 않는다. 일치 여부와 단계 문자열만 남긴다.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assessConstructionPerception,
  type EcosIndicatorKey,
  type PerceptionInput,
} from '@/domain/risk/construction-perception/construction-perception';
import { ratio } from '@/domain/shared/amount';
import { parseYearMonth, type YearMonth } from '@/domain/shared/year-month';

const FILES = {
  raw: resolve(process.cwd(), 'fixtures/건설경기인식지수-원값.csv'),
  errorRates: resolve(process.cwd(), 'fixtures/분양회수-오차율-엑셀.csv'),
  results: resolve(process.cwd(), 'fixtures/건설경기인식지수-엑셀결과.csv'),
  expected: resolve(process.cwd(), 'fixtures/건설경기인식지수-기대값.csv'),
};
const present = Object.values(FILES).every(existsSync);

function readCsv(path: string): Record<string, string>[] {
  const [header, ...lines] = readFileSync(path, 'utf8').trim().split(/\r?\n/);
  const keys = header.split(',');
  return lines.map((line) => Object.fromEntries(line.split(',').map((v, i) => [keys[i], v])));
}

describe.skipIf(!present)('엑셀 동등성 — ECOS 9종과 산식 (정책 §8)', () => {
  let input: PerceptionInput;

  beforeAll(() => {
    const series = {} as Record<EcosIndicatorKey, Map<YearMonth, number>>;
    for (const row of readCsv(FILES.raw)) {
      const month = parseYearMonth(row['시점']);
      for (const [key, value] of Object.entries(row)) {
        if (key === '시점') continue;
        const map = (series[key as EcosIndicatorKey] ??= new Map());
        if (value !== '') map.set(month, Number(value));
      }
    }
    const excelError = new Map(readCsv(FILES.errorRates).map((r) => [r['시점'], Number(r['오차율'])]));
    input = {
      series,
      forecastError: (t) => {
        const v = excelError.get(t);
        return v === undefined ? { missing: `엑셀에 ${t} 오차율이 없습니다.` } : ratio(v);
      },
    };
  });

  it('인계 fixture 35개월(2023/08~2026/06)의 지수가 소수점 6자리까지, 단계가 전부 같다', () => {
    const rows = readCsv(FILES.expected).filter((r) => r['시점'] !== '2026/07');
    expect(rows).toHaveLength(35);
    for (const row of rows) {
      const r = assessConstructionPerception(input, parseYearMonth(row['시점']));
      if (r.kind !== 'ok') throw new Error(`${row['시점']}: ${JSON.stringify(r.missing)}`);
      expect(r.index, row['시점']).toBeCloseTo(Number(row['종합위기인식지수']), 6);
      expect(r.grade, row['시점']).toBe(row['종합위기단계']);
    }
  });

  it('2026/07은 엑셀의 "위기"가 아니라 산출불가다 — ECOS 빈칸 8개를 알린다', () => {
    const r = assessConstructionPerception(input, parseYearMonth('2026/07'));
    expect(r.kind).toBe('unavailable');
    if (r.kind !== 'unavailable') return;
    expect(r.missing.map((m) => m.key).sort()).toEqual(
      ['총수주액', '미분양주택현황', '주택건설인허가실적', '설비투자지수', '대출금리', '환율', '주가', '선행지수순환변동치'].sort(),
    );
  });

  it('엑셀 127개월 전체 — 산출되는 달은 모두 엑셀과 같고, 산출불가는 자료가 없는 세 달뿐이다', () => {
    const unavailable: string[] = [];
    let matched = 0;
    for (const row of readCsv(FILES.results)) {
      const r = assessConstructionPerception(input, parseYearMonth(row['시점']));
      if (r.kind !== 'ok') {
        unavailable.push(row['시점']);
        continue;
      }
      expect(r.index, row['시점']).toBeCloseTo(Number(row['종합위기인식지수']), 6);
      expect(r.grade, row['시점']).toBe(row['종합위기단계']);
      matched++;
    }
    // 2026/07: ECOS 미입력. 2016/01·02: 엑셀 오차율이 없다(엑셀은 0점, 정책 D9).
    expect(unavailable.sort()).toEqual(['2016/01', '2016/02', '2026/07']);
    expect(matched).toBe(124);
  });
});
