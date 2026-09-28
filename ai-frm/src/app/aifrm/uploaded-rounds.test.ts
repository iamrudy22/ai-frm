import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { arrangeRounds, requirementsOf, roundsText } from '@/app/aifrm/uploaded-rounds';
import { readStatement } from '@/infrastructure/xlsx/statement-reader';

const HEADER = ['', '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

/** 기준일이 2026-MM인 최소 회차. */
function statementOf(month: number) {
  const row = (label: string) => [label, ...HEADER.slice(1).map(() => 100)];
  const aoa = [[], [`2026-${String(month).padStart(2, '0')}-10(단위: 억원)`], HEADER, [], row('기초시재'), row('수입'), row('분양회수'), row('지출')];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(aoa), '12_26년자금수지표(본운영반영)');
  const result = readStatement(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  if (!result.ok) throw new Error(result.error);
  return result.statement;
}

const named = (file: string, month: number) => ({ file, statement: statementOf(month) });

describe('올린 회차 정리', () => {
  it('가장 늦은 회차가 최신, 그 직전 달 회차가 이전 회차다 — 올린 순서와 상관없다', () => {
    const r = arrangeRounds([named('a', 5), named('b', 8), named('c', 7), named('d', 6)]);
    if (!r.ok) throw new Error(r.reason);
    expect(r.latest.file).toBe('b');
    expect(r.previous?.file).toBe('c');
    expect(r.rounds.map((x) => x.round)).toEqual(['2026/05', '2026/06', '2026/07', '2026/08']);
  });

  it('직전 달 회차가 없으면 이전 회차는 없다 — 떨어진 회차를 이전 회차로 쓰지 않는다', () => {
    const r = arrangeRounds([named('a', 5), named('b', 8)]);
    if (!r.ok) throw new Error(r.reason);
    expect(r.previous).toBeNull();
  });

  it('회차마다 쓰임을 붙인다', () => {
    const r = arrangeRounds([named('a', 6), named('b', 8), named('c', 7)]);
    if (!r.ok) throw new Error(r.reason);
    expect(r.rounds.map((x) => [x.round, x.role])).toEqual([
      ['2026/06', '분양회수'],
      ['2026/07', '이전 회차'],
      ['2026/08', '최신 회차'],
    ]);
  });

  it('같은 회차 파일이 두 개면 거부하고 파일 이름을 알린다', () => {
    const r = arrangeRounds([named('a.xlsx', 7), named('b.xlsx', 7)]);
    expect(r).toEqual({ ok: false, reason: '2026/07 회차 파일이 두 개입니다: a.xlsx, b.xlsx. 하나만 올려 주세요.' });
  });

  it('파일이 없으면 거부한다', () => {
    expect(arrangeRounds([]).ok).toBe(false);
  });
});

describe('산출 전 필요 회차 확인', () => {
  const have = (...rounds: string[]) => rounds.map((r) => r as never);

  it('최신 회차 8월이면 — Gap·시재는 8월, 대금 회수는 7·8월, 건설경기(기준월 6월)는 3~6월', () => {
    expect(requirementsOf(have('2026/04', '2026/05', '2026/06', '2026/07', '2026/08'))).toEqual([
      { indicator: '유동성 Gap · 적정 시재', needed: ['2026/08'], missing: [], ifMissing: '' },
      { indicator: '대금 회수 위험', needed: ['2026/07', '2026/08'], missing: [], ifMissing: '판정하지 않습니다' },
      {
        indicator: '건설경기 인식 지수 (기준월 2026/06)',
        needed: ['2026/03', '2026/04', '2026/05', '2026/06'],
        missing: ['2026/03'],
        ifMissing: '기본 기준월로는 산출불가입니다',
      },
    ]);
  });

  it('최신 회차 하나만 올리면 무엇이 빠졌는지 모두 알린다', () => {
    const r = requirementsOf(have('2026/08'));
    expect(r.map((x) => x.missing)).toEqual([[], ['2026/07'], ['2026/03', '2026/04', '2026/05', '2026/06']]);
  });

  it('연도를 넘는 회차도 달력으로 센다 — 최신 2월이면 건설경기는 전년 9~12월', () => {
    const r = requirementsOf(have('2026/02'));
    expect(r[2]).toMatchObject({ indicator: '건설경기 인식 지수 (기준월 2025/12)', needed: ['2025/09', '2025/10', '2025/11', '2025/12'] });
  });
});

describe('회차 목록 표기', () => {
  it('이어진 셋 이상은 범위로, 아니면 가운뎃점으로', () => {
    expect(roundsText(['2026/03', '2026/04', '2026/05', '2026/06'] as never)).toBe('2026/03~2026/06');
    expect(roundsText(['2026/07', '2026/08'] as never)).toBe('2026/07·2026/08');
    expect(roundsText(['2026/03', '2026/05', '2026/06'] as never)).toBe('2026/03·2026/05·2026/06');
    expect(roundsText(['2026/08'] as never)).toBe('2026/08');
  });
});
