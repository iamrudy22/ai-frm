import { describe, it, expect } from 'vitest';
import { adequateCashTile, gapTile, perceptionTile, recoveryBasis, recoveryTile } from '@/app/aifrm/summary-view';

const ym = (s: string) => s as never;

describe('요약 — 대금 회수 위험', () => {
  // 7월 판단은 7월 회차에 적힌 가장 최근 실적(6월)을 6월 회차의 6월 계획과 견준다.
  it('판정했으면 등급, 회수율, 판단월과 실적 기준월', () => {
    const tile = recoveryTile({ ok: true, value: { kind: 'ok', rate: 0.989, grade: '정상' } as never }, {
      judged: ym('2026/07'),
      target: ym('2026/06'),
      previousRound: ym('2026/06'),
    });
    expect(tile).toEqual({
      title: '대금 회수 위험',
      status: { kind: 'grade', grade: '정상' },
      value: '98.9%',
      note: '회수율 · 2026/07 판단 · 2026/06 실적 기준',
    });
  });

  it('판단월은 최신 회차의 달, 실적 기준월은 그 직전 달이다', () => {
    expect(recoveryBasis(ym('2026/07'), ym('2026/06'))).toBe('2026/07 판단 · 2026/06 실적 기준');
    expect(recoveryBasis(ym('2026/07'), null)).toBe('2026/07 판단');
  });

  it('이전 회차가 없으면 판정 안 함과 빠진 회차', () => {
    expect(recoveryTile(null, { judged: ym('2026/08'), target: null, previousRound: ym('2026/07') })).toEqual({
      title: '대금 회수 위험',
      status: { kind: 'dot', variant: 'neutral', label: '판정 안 함' },
      value: '—',
      note: '2026/07 회차가 없습니다',
    });
  });

  it('판정하지 못했으면 판정 불가', () => {
    expect(recoveryTile({ ok: false, reason: 'x' }, { judged: ym('2026/08'), target: null, previousRound: ym('2026/07') })).toMatchObject({
      status: { kind: 'dot', variant: 'error', label: '판정 불가' },
      value: '—',
      note: '아래 사유를 확인하세요',
    });
  });
});

describe('요약 — 유동성 Gap', () => {
  it('순지출이면 등급과 Gap 비율, 관측 구간', () => {
    expect(gapTile({ ok: true, value: { kind: 'gap', gapRatio: 1.69, grade: '정상' } as never }, '2026/08~2026/10')).toEqual({
      title: '유동성 Gap',
      status: { kind: 'grade', grade: '정상' },
      value: '169.0%',
      note: '2026/08~2026/10',
    });
  });

  it('순유입이면 비율 대신 순유입', () => {
    expect(gapTile({ ok: true, value: { kind: 'net-inflow', grade: '정상' } as never }, '2026/08~2026/10')).toMatchObject({
      value: '순유입',
    });
  });

  it('산출하지 못했으면 산출 불가', () => {
    expect(gapTile({ ok: false, reason: 'x' }, '—').status).toEqual({ kind: 'dot', variant: 'error', label: '산출 불가' });
  });
});

describe('요약 — 적정 시재 (등급 없음)', () => {
  it('안정적이면 T와 초록 점, 여유분(+)은 보조 문장에', () => {
    expect(adequateCashTile({ ok: true, value: { isAdequate: true, surplus: 92603.4 } as never }, '2026/08~2026/10')).toEqual({
      title: '적정 시재',
      status: { kind: 'dot', variant: 'success', label: '안정적' },
      value: 'T',
      note: '현재 − 적정 +92,603 억원 · 2026/08~2026/10',
    });
  });

  it('부족하면 F와 경고 점, 부족분(−)', () => {
    expect(adequateCashTile({ ok: true, value: { isAdequate: false, surplus: -1234 } as never }, 's')).toMatchObject({
      status: { kind: 'dot', variant: 'warning', label: '적정시재 부족' },
      value: 'F',
      note: '현재 − 적정 −1,234 억원 · s',
    });
  });
});

describe('요약 — 건설경기 인식 지수', () => {
  const ok = (result: unknown) => ({ ok: true as const, value: { result } as never });

  it('불러오는 중', () => {
    expect(perceptionTile(null)).toMatchObject({ status: { kind: 'dot', variant: 'neutral', label: '불러오는 중' }, value: '…' });
  });

  it('산출했으면 종합위기단계와 지수, 기준월', () => {
    expect(perceptionTile(ok({ kind: 'ok', month: '2026/06', index: 11.4321, grade: '정상' }))).toEqual({
      title: '건설경기 인식 지수',
      status: { kind: 'grade', grade: '정상' },
      value: '11.43',
      note: '종합위기인식지수 · 기준월 2026/06',
    });
  });

  it('산출불가면 몇 개 지표가 비었는지', () => {
    expect(perceptionTile(ok({ kind: 'unavailable', month: '2026/06', missing: [{}, {}] }))).toMatchObject({
      status: { kind: 'dot', variant: 'warning', label: '산출불가' },
      value: '—',
      note: '기준월 2026/06 · 2개 지표 값 없음',
    });
  });

  it('요청이 실패했으면 산출 불가', () => {
    expect(perceptionTile({ ok: false, reason: 'x' }).status).toEqual({ kind: 'dot', variant: 'error', label: '산출 불가' });
  });
});
