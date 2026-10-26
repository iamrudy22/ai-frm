import { describe, expect, it } from 'vitest';
import { HISTORY_CALCULATION_VERSION, HISTORY_TEMPLATE_VERSION } from '../../domain/report-history/report-history';
import { SCORING_RULES } from '../../domain/risk/construction-perception/policy';
import { parseYearMonth } from '../../domain/shared/year-month';
import type { ReportCorrectionDependencies, StoredWorkbookExport } from './ports';
import { downloadCorrectionWorkbook, exportCorrectionWorkbook } from './report-correction';
const evidenceToJson = (value: unknown) => value as never;
const evidenceFromJson = <T,>(value: unknown): T => value as T;
const historyWorkbookCodec = { structure: () => ({ sheets: [] }), encode: (manifest: StoredWorkbookExport) => new TextEncoder().encode(JSON.stringify(manifest)) };

it('내보내기는 먼저 서버 명세를 영속 저장하고 같은 ID를 다시 다운로드한다', async () => {
  const service = await import('./report-correction');
  expect(typeof service.exportCorrectionWorkbook).toBe('function');
  expect(typeof service.downloadCorrectionWorkbook).toBe('function');
});

describe('revision-bound export', () => {
  const scopeId = 'scope-A';
  const confirmationId = '11111111-1111-4111-8111-111111111111';
  const exportId = '22222222-2222-4222-8222-222222222222';
  const basis = { reportCycle: parseYearMonth('2026/08'), reportTitleMonth: parseYearMonth('2026/07'), constructionBaseMonth: parseYearMonth('2026/06'),
    fundingJudgedMonth: parseYearMonth('2026/08'), fundingObservedMonth: parseYearMonth('2026/07'), gapMonth: parseYearMonth('2026/08') };
  const statements = [{ asOf: { year: 2026, month: 8, day: 31 }, monthLabels: ['7월', '8월'], baseMonthIndex: 1, planYearEndIndex: 1,
    amounts: { 기초시재: [0, 1.0000000000000002], 수입계: [2, 3], 수입: [4, 5], 분양회수: [-1, 6], 기타수입: [7, 8], 지출: [9, 10] } }];
  function fixture(corrected = false, failure: 'missing-input' | 'old-version' | null = null, withPoints = false) {
    const series = Object.fromEntries(SCORING_RULES.filter(rule => rule.key !== '분양회수예측오차').map(rule => [rule.key,
      { unit: '원단위', values: new Map([[basis.constructionBaseMonth, 1.0000000000000002], [parseYearMonth('2025/06'), 0], [parseYearMonth('2026/05'), -0.5]]) }])) as never;
    const ecos = { captureId: 'ecos-1', scopeId, sourceKind: 'ecos', schemaVersion: 1, contentHash: 'ecos-hash', payloadJson: evidenceToJson({ kind: 'returned', value: series }), receivedAt: '2026-10-23T00:00:00.000Z', derivation: { kind: 'captured' } };
    const kofia = { captureId: 'kofia-1', scopeId, sourceKind: 'kofia', schemaVersion: 1, contentHash: 'kofia-hash', payloadJson: evidenceToJson({ kind: 'returned', value: { days: [{ date: '2026/07/31', publicAaa: { average: 3.674, byAgency: { A: 1 } }, treasury: { average: 2.5, byAgency: { A: 2 } } }], fetchedAt: new Date('2026-08-01T00:00:00.000Z') } }), receivedAt: '2026-10-23T00:00:00.000Z', derivation: { kind: 'captured' } };
    const metrics = [{ id: 'funding', title: '조달위험', value: '1.174', status: '정상', grade: '정상', formula: 'AAA−국고채',
      points: withPoints ? [{ month: '2026/07', kind: 'available', value: 1.174 }] : [] }];
    const localMetrics = [
      { id: 'recovery', title: '대금 회수 위험', value: '0', status: '정상', grade: '정상', formula: '실적/계획', points: [{ month: '2026/06', kind: 'available', value: 0 }] },
      { id: 'liquidity', title: '유동성 Gap', value: '—', status: '비적용', grade: null, formula: '기초시재/순지출', points: [{ month: '2026/07', kind: 'not-applicable', value: null, reason: '순유입' }] },
      { id: 'cash', title: '적정 시재', value: '42', status: '정상', grade: null, formula: 'LCR', points: [{ month: '2026/08', kind: 'available', value: 42, secondary: 40 }] },
      { id: 'construction', title: '건설경기 인식 지수', value: '41.25', status: '경고', grade: '경고', formula: '가중합', points: [{ month: '2026/05', kind: 'available', value: 41.25 }] },
    ];
    const document = { schemaVersion: 1, templateVersion: HISTORY_TEMPLATE_VERSION, contentHash: 'document-hash', json: { metrics: withPoints ? [...localMetrics, ...metrics] : metrics }, historyCalculationIds: [] };
    const confirmation = { scopeId, confirmationId, candidateId: 'candidate-1', revision: 2, reportCycle: basis.reportCycle, confirmedAt: '2026-10-23T00:00:00.000Z', previousConfirmationId: null, basis,
      canonicalCurrentCalculationIds: { construction: 'construction-1', funding: 'funding-1' }, historySelectionId: 'selection-1', document };
    const candidate = { ...confirmation, inputSnapshotId: 'input-1', inputHash: 'input-hash', calculationVersion: failure === 'old-version' ? 'legacy' : HISTORY_CALCULATION_VERSION,
      correctionPreviewId: corrected ? 'preview-1' : null, calculationIds: confirmation.canonicalCurrentCalculationIds, document };
    const snapshot = { scopeId, inputSnapshotId: 'input-1', inputHash: 'input-hash', sourceMetadata: { files: ['synthetic.xlsx'] }, statements, derivation: { kind: 'captured' }, createdAt: '2026-10-23T00:00:00.000Z' };
    const calculation = { scopeId, calculationVersion: HISTORY_CALCULATION_VERSION, indicator: 'construction', calculationId: 'construction-1', captureIds: ['ecos-1'] };
    const selection = { scopeId, historySelectionId: 'selection-1', headRevisions: [{ reportCycle: basis.reportCycle, revision: 2, confirmationId }],
      calculations: [{ ...calculation, calculationId: 'past-1', effectiveMonth: parseYearMonth('2026/05'), origin: 'reconstructed', resultJson: evidenceToJson({ ok: true, value: { result: { kind: 'ok', index: 41.25, grade: '경고' } } }) }] };
    let stored: StoredWorkbookExport | null = null;
    const deps = { calculationVersion: HISTORY_CALCULATION_VERSION, metadataClock: () => new Date('2026-10-24T01:00:00.000Z'), nextId: () => exportId,
      decode: evidenceFromJson, workbookCodec: historyWorkbookCodec, ecosCatalog: SCORING_RULES.filter(rule => rule.key !== '분양회수예측오차').map(rule => ({ key: rule.key, stat: 'adapter-series', items: ['synthetic'] })),
      repository: { getConfirmation: async (scope: string) => scope === scopeId ? confirmation : null,
        getCandidate: async (scope: string) => scope === scopeId ? candidate : null,
        getInputSnapshot: async (scope: string) => scope === scopeId && failure !== 'missing-input' ? snapshot : null,
        getHistorySelection: async (scope: string) => scope === scopeId ? selection : null,
        getCalculation: async (_scope: string, id: string) => id === 'construction-1' ? calculation : { ...calculation, indicator: 'funding', calculationId: 'funding-1', captureIds: ['kofia-1'] },
        getEvidence: async (_scope: string, id: string) => id === 'ecos-1' ? ecos : kofia,
        putWorkbookExport: async (value: StoredWorkbookExport) => { stored = value; return value; },
        getWorkbookExport: async (scope: string) => scope === scopeId ? stored : null },
    } as unknown as ReportCorrectionDependencies;
    return { deps, stored: () => stored };
  }

  it('export_preserves_input_and_source_lineage: 현재 산출의 원천과 전체 자금 계열을 쓴다', async () => {
    const { deps } = fixture();
    const saved = await exportCorrectionWorkbook(deps, scopeId, confirmationId);
    expect(saved.baseRevision).toBe(2);
    expect(saved.rows.filter(row => row.sourceKind === 'ecos')).toHaveLength(18);
    expect(saved.rows.filter(row => row.sourceKind === 'statement')).toHaveLength(12);
    expect(saved.rows.filter(row => row.sourceKind === 'kofia')).toHaveLength(2);
    expect(saved.rows.find(row => row.rowId === 'statement:0:기초시재:1')).toMatchObject({ originalValue: 1.0000000000000002, unit: '억원', fieldPath: 'statements[0].amounts.기초시재[1]' });
    expect(saved.rows.find(row => row.rowId === 'kofia:2026/07/31:publicAaa')).toMatchObject({ originalValue: 3.674, unit: '%', protectedCells: { byAgency: { A: 1 } } });
    expect(saved.rows.find(row => row.rowId === 'ecos:총수주액:2025/06')).toMatchObject({ originalValue: 0, sourceRecordId: 'ecos-1' });
    expect(saved.result).toEqual([{ title: '조달위험', value: '1.174', status: '정상', grade: '정상', formula: 'AAA−국고채' }]);
    await expect(exportCorrectionWorkbook(deps, 'other-scope', confirmationId)).rejects.toThrow('NOT_FOUND');
  });

  it('저장된 명세로 재다운로드하고 scope를 격리한다', async () => {
    const { deps } = fixture();
    await exportCorrectionWorkbook(deps, scopeId, confirmationId);
    const first = await downloadCorrectionWorkbook(deps, scopeId, exportId);
    const second = await downloadCorrectionWorkbook(deps, scopeId, exportId);
    expect(first).toEqual(second);
    await expect(downloadCorrectionWorkbook(deps, 'other-scope', exportId)).rejects.toThrow('NOT_FOUND');
  });
  it('선택된 과거 계산과 정정 확정본도 같은 revision에 묶어 내보낸다', async () => {
    const { deps } = fixture(true);
    const saved = await exportCorrectionWorkbook(deps, scopeId, confirmationId);
    expect(saved.history).toContainEqual({ kind: 'calculation', indicator: 'construction', month: '2026/05', calculationId: 'past-1',
      origin: 'reconstructed', status: 'ok', value: '41.25', grade: '경고', reason: '' });
    expect(saved.baseRevision).toBe(2);
  });
  it('입력 snapshot 부재와 미지원 계산 버전에서는 파일용 명세를 만들지 않는다', async () => {
    const missing = fixture(false, 'missing-input');
    await expect(exportCorrectionWorkbook(missing.deps, scopeId, confirmationId)).rejects.toThrow('NOT_FOUND');
    expect(missing.stored()).toBeNull();
    const old = fixture(false, 'old-version');
    await expect(exportCorrectionWorkbook(old.deps, scopeId, confirmationId)).rejects.toThrow('UNSUPPORTED_VERSION');
    expect(old.stored()).toBeNull();
  });
  it('저장 문서의 다섯 지표 조회점과 내부 지표의 0·비적용·보조값을 보존한다', async () => {
    const { deps } = fixture(false, null, true);
    const saved = await exportCorrectionWorkbook(deps, scopeId, confirmationId);
    expect(saved.history).toContainEqual(expect.objectContaining({ kind: 'report-point', indicator: 'recovery', month: '2026/06', status: 'available', value: '0', lineage: 'stored-document' }));
    expect(saved.history).toContainEqual(expect.objectContaining({ kind: 'report-point', indicator: 'liquidity', month: '2026/07', status: 'not-applicable', reason: '순유입' }));
    expect(saved.history).toContainEqual(expect.objectContaining({ kind: 'report-point', indicator: 'cash', month: '2026/08', value: '42', secondary: '40' }));
    expect(saved.history).toContainEqual(expect.objectContaining({ kind: 'report-point', indicator: 'construction', month: '2026/05', calculationId: 'past-1', value: '41.25' }));
    expect(saved.history).toContainEqual(expect.objectContaining({ kind: 'report-point', indicator: 'funding', month: '2026/07', calculationId: 'funding-1', value: '1.174' }));
  });
});
