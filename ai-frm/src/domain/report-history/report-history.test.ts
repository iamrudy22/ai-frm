import { describe, expect, it } from 'vitest';
import { confirmDecision, type ReportBasis } from './report-history';
import { yearMonth } from '../shared/year-month';
const m = yearMonth(2026, 9);
const basis: ReportBasis = { reportCycle: m, reportTitleMonth: yearMonth(2026, 8), constructionBaseMonth: yearMonth(2026, 7), fundingJudgedMonth: m, fundingObservedMonth: yearMonth(2026, 8), gapMonth: m };
describe('월별 확정 결정', () => {
  it('처음은 revision 1이며 이후에는 사유와 현재 revision이 필요하다', () => {
    expect(confirmDecision(basis, 0, 0)).toEqual({ kind: 'create', revision: 1 });
    expect(confirmDecision(basis, 1, 1).kind).toBe('not-ready');
    expect(confirmDecision(basis, 1, 0, '사유').kind).toBe('conflict');
    expect(confirmDecision(basis, 1, 1, '합성자료 정정')).toEqual({ kind: 'create', revision: 2 });
    expect(confirmDecision(basis, 1, 1, '   ').kind).toBe('not-ready');
  });
  it('음수/소수 revision과 잘못된 달력은 거절한다', () => {
    expect(confirmDecision(basis, 0, -1).kind).toBe('not-ready');
    expect(confirmDecision(basis, 0.5, 0.5).kind).toBe('not-ready');
    expect(confirmDecision({ ...basis, gapMonth: '2026/13' as typeof m }, 0, 0).kind).toBe('not-ready');
  });
  it('canonical 회차 월 대응을 강제하고 연도 경계는 허용한다', () => {
    for (const field of ['reportTitleMonth', 'constructionBaseMonth', 'fundingJudgedMonth', 'fundingObservedMonth', 'gapMonth'] as const) {
      const wrongMonth = field === 'fundingJudgedMonth' || field === 'gapMonth' ? yearMonth(2026, 8) : m;
      expect(confirmDecision({ ...basis, [field]: wrongMonth }, 0, 0)).toMatchObject({ kind: 'not-ready', reason: 'INVALID_BASIS' });
    }
    const january = yearMonth(2027, 1);
    expect(confirmDecision({ reportCycle: january, reportTitleMonth: yearMonth(2026, 12), constructionBaseMonth: yearMonth(2026, 11), fundingJudgedMonth: january, fundingObservedMonth: yearMonth(2026, 12), gapMonth: january }, 0, 0)).toEqual({ kind: 'create', revision: 1 });
  });
});

describe('직접 입력 출처 runtime 계약', () => {
  it('세 종류만 정확한 shape로 허용하고 manual root의 identity·revision·hash·시각을 강제한다', async () => {
    const { isDerivation } = await import('./report-history');
    const manual = { kind: 'manual-input', draftId: '11111111-1111-4111-8111-111111111111', draftRevision: 1, rawInputHash: 'a'.repeat(64), recordedAt: '2026-12-31T12:34:56.000Z' };
    expect(isDerivation(manual)).toBe(true); expect(isDerivation({ kind: 'captured' })).toBe(true);
    expect(isDerivation({ kind: 'manual-correction', importId: 'legacy-import', parentId: 'legacy-parent', patchHash: 'legacy-hash', correctedAt: manual.recordedAt })).toBe(true);
    for (const invalid of [null, { kind: 'future' }, { kind: 'captured', parentId: 'x' }, { ...manual, parentId: manual.draftId }, { ...manual, draftId: 'bad' }, { ...manual, draftRevision: 0 }, { ...manual, draftRevision: 1.5 }, { ...manual, rawInputHash: 'x' }, { ...manual, recordedAt: '2026-02-30T12:34:56.000Z' }, { ...manual, recordedAt: '2026-12-31' }, { ...manual, recordedAt: '2026-12-31T12:34:56.000Zjunk' }]) expect(isDerivation(invalid)).toBe(false);
  });
});
