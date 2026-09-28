import { describe, it, expect } from 'vitest';
import { assessDashboard } from '@/application/dashboard';
import {
  createStatement,
  unreadable,
  type ItemSeries,
  type ItemName,
  type Statement,
} from '@/domain/cashflow/statement';
import { amount } from '@/domain/shared/amount';

// 합성 회차. 수입계 300·지출 600으로 매달 기초시재가 300씩 줄어 롤포워드가 맞는다.
const LABELS = ['6월', '7월', '8월', '9월', '10월', '11월'];
const series = (values: readonly number[]) => values.map(amount);
const flat = (n: number) => series(LABELS.map(() => n));

function statement(
  asOf: Date,
  baseMonthIndex: number,
  over: Partial<Record<ItemName, ItemSeries>> = {},
): Statement {
  return createStatement({
    asOf,
    monthLabels: LABELS,
    baseMonthIndex,
    planYearEndIndex: LABELS.length - 1,
    amounts: {
      기초시재: series([3000, 2700, 2400, 2100, 1800, 1500]),
      수입계: flat(300),
      수입: flat(300),
      분양회수: flat(0),
      기타수입: flat(0),
      지출: flat(600),
      ...over,
    },
  });
}

// 7월 회차의 7월 분양회수(계획) 50,000 → 8월 회차의 7월 분양회수(실적) 40,000 = 0.8
const july = statement(new Date(2026, 6, 8), 1, { 분양회수: series([0, 50000, 0, 0, 0, 0]) });
const august = statement(new Date(2026, 7, 10), 2, { 분양회수: series([0, 40000, 0, 0, 0, 0]) });
const aug = august.months[2];

describe('대시보드 — 지표별 결과', () => {
  it('두 회차가 있으면 두 지표 모두 산출한다', () => {
    const d = assessDashboard(july, august, aug);
    expect(d.paymentRecovery).toMatchObject({ ok: true, value: { grade: '주의' } });
    expect(d.liquidityGap.ok).toBe(true);
  });

  it('대금 회수는 회차 기준월로, 유동성 Gap은 고른 기준월로 셈한다', () => {
    const sep = august.months[3];
    const d = assessDashboard(july, august, sep);
    // 기준월을 9월로 바꿔도 대금 회수의 판정 대상은 최신 회차의 직전 월(7월)이다.
    expect(d.paymentRecovery).toMatchObject({ ok: true, value: { targetMonthLabel: '7월' } });
    // 유동성 Gap은 9월 기초시재를 쓴다.
    expect(d.liquidityGap).toMatchObject({ ok: true, value: { openingCash: 2100 } });
  });

  it('이전 회차가 없으면 대금 회수는 없음(null)이고 유동성 Gap은 산출한다', () => {
    const d = assessDashboard(null, august, aug);
    expect(d.paymentRecovery).toBeNull();
    expect(d.liquidityGap.ok).toBe(true);
    expect(d.diagnostics.order).toBeNull();
  });
});

// 지표 분리 요구의 최종 확인 — 한 지표의 실패가 다른 지표로 번지지 않는다.
describe('대시보드 — 실패 격리', () => {
  it('회차가 연속하지 않으면 대금 회수만 실패하고, 순서 경고가 진단에 실린다', () => {
    const june = statement(new Date(2026, 5, 9), 0);
    const d = assessDashboard(june, august, aug);
    expect(d.paymentRecovery).toMatchObject({ ok: false });
    expect(d.paymentRecovery?.ok === false && d.paymentRecovery.reason).toMatch(/연속/);
    expect(d.liquidityGap.ok).toBe(true);
    expect(d.diagnostics.order).toMatchObject({ ok: false });
  });

  it('기준월에서 3개월 창이 모자라면 유동성 Gap만 실패한다', () => {
    const nov = august.months[5];
    const d = assessDashboard(july, august, nov);
    expect(d.liquidityGap).toMatchObject({ ok: false });
    expect(d.liquidityGap.ok === false && d.liquidityGap.reason).toMatch(/모자랍니다/);
    expect(d.paymentRecovery?.ok).toBe(true);
  });

  it('분양회수를 읽지 못하면 대금 회수만 실패하고, 읽지 못한 항목이 진단에 실린다', () => {
    const broken = statement(new Date(2026, 7, 10), 2, { 분양회수: unreadable('10월 칸이 비어 있습니다.') });
    const d = assessDashboard(july, broken, aug);
    expect(d.paymentRecovery?.ok === false && d.paymentRecovery.reason).toMatch(/분양회수/);
    expect(d.liquidityGap.ok).toBe(true);
    expect(d.diagnostics.unreadable).toEqual([{ item: '분양회수', reason: '10월 칸이 비어 있습니다.' }]);
  });

  it('수입을 읽지 못하면 유동성 Gap만 실패한다', () => {
    const broken = statement(new Date(2026, 7, 10), 2, {
      분양회수: series([0, 40000, 0, 0, 0, 0]),
      수입: unreadable('행이 없습니다.'),
    });
    const d = assessDashboard(july, broken, aug);
    expect(d.liquidityGap.ok === false && d.liquidityGap.reason).toMatch(/수입/);
    expect(d.paymentRecovery?.ok).toBe(true);
  });

  it('계획값이 0이라 판정할 수 없는 경우도 같은 실패 모양으로 모인다', () => {
    const noPlan = statement(new Date(2026, 6, 8), 1);
    const d = assessDashboard(noPlan, august, aug);
    expect(d.paymentRecovery).toMatchObject({ ok: false });
    expect(d.paymentRecovery?.ok === false && d.paymentRecovery.reason).toMatch(/계획값/);
  });
});

describe('대시보드 — 적정 시재', () => {
  // 8월 기준이면 8월만 낸다(2026-09-28 결정). 다음 달들의 추이는 내지 않는다.
  it('고른 기준월 한 달치만 낸다 — 다음 달들의 추이는 없다', () => {
    const d = assessDashboard(july, august, aug);
    expect(d.adequateCash.ok).toBe(true);
    if (!d.adequateCash.ok) return;
    expect(d.adequateCash.value.month.label).toBe('8월');
    expect(d.adequateCash.value).not.toHaveProperty('series');
  });

  it('기준월을 바꾸면 그 달 한 달치를 낸다', () => {
    const d = assessDashboard(july, august, august.months[3]);
    if (!d.adequateCash.ok) throw new Error('산출돼야 한다');
    expect(d.adequateCash.value.month.label).toBe('9월');
    expect(d.adequateCash.value.isPlan).toBe(true);
  });

  it('결과에 등급이 없다 — T/F만 있다', () => {
    const d = assessDashboard(july, august, aug);
    if (!d.adequateCash.ok) throw new Error('산출돼야 한다');
    expect(d.adequateCash.value).not.toHaveProperty('grade');
    expect(typeof d.adequateCash.value.isAdequate).toBe('boolean');
  });

  it('이전 회차 없이도 산출한다 — 최신 회차 한 장만 쓴다', () => {
    expect(assessDashboard(null, august, aug).adequateCash.ok).toBe(true);
  });

  // 지표 분리의 최종 확인: 적정 시재만 쓰는 항목이 깨져도 다른 두 지표는 산출된다.
  it('기타수입을 읽지 못하면 적정 시재만 실패하고 다른 두 지표는 산출된다', () => {
    const broken = statement(new Date(2026, 7, 10), 2, {
      분양회수: series([0, 40000, 0, 0, 0, 0]),
      기타수입: unreadable('"기타수입"의 10월 칸이 비어 있습니다.'),
    });
    const d = assessDashboard(july, broken, aug);
    expect(d.adequateCash.ok === false && d.adequateCash.reason).toMatch(/기타수입/);
    expect(d.paymentRecovery?.ok).toBe(true);
    expect(d.liquidityGap.ok).toBe(true);
  });

  it('기준월에서 3개월 창이 모자라면 적정 시재도 실패한다', () => {
    const d = assessDashboard(july, august, august.months[5]);
    expect(d.adequateCash.ok === false && d.adequateCash.reason).toMatch(/모자랍니다/);
  });
});

describe('대시보드 — 진단', () => {
  it('롤포워드가 맞으면 진단이 비어 있다', () => {
    expect(assessDashboard(july, august, aug).diagnostics.rollForward).toEqual([]);
  });

  it('롤포워드가 어긋나면 진단에 싣되 판정은 막지 않는다', () => {
    const broken = statement(new Date(2026, 7, 10), 2, {
      분양회수: series([0, 40000, 0, 0, 0, 0]),
      기초시재: series([3000, 2700, 9999, 2100, 1800, 1500]),
    });
    const d = assessDashboard(july, broken, aug);
    expect(d.diagnostics.rollForward.length).toBeGreaterThan(0);
    expect(d.liquidityGap.ok).toBe(true);
    expect(d.paymentRecovery?.ok).toBe(true);
  });
});
