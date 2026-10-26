import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { historyWorkbookCodec } from './history-workbook';

const base = { scopeId: 'scope-A', exportId: '22222222-2222-4222-8222-222222222222', workbookFormatVersion: 1,
  baseConfirmationId: 'confirmation-1', baseRevision: 1, baseDocumentHash: 'hash',
  basis: { reportCycle: '2026/08', reportTitleMonth: '2026/07', constructionBaseMonth: '2026/06', fundingJudgedMonth: '2026/08', fundingObservedMonth: '2026/07', gapMonth: '2026/08' },
  inputSnapshotId: 'input-1', inputHash: 'input-hash', calculationIds: { construction: 'c', funding: 'f' }, historySelectionId: 'history-1',
  calculationVersion: 'v', templateVersion: 't', createdAt: '2026-10-23T00:00:00.000Z', history: [], result: [] };

describe('정정용 엑셀', () => {
  it('export_preserves_number_roundtrip: 기준값과 메모는 수식 없는 문자열이다', async () => {
    const codec = await import('./history-workbook');
    const draft = {
      scopeId: 'scope-A', exportId: '22222222-2222-4222-8222-222222222222', workbookFormatVersion: 1,
      baseConfirmationId: 'confirmation-1', baseRevision: 1, baseDocumentHash: 'hash',
      basis: { reportCycle: '2026/08', reportTitleMonth: '2026/07', constructionBaseMonth: '2026/06', fundingJudgedMonth: '2026/08', fundingObservedMonth: '2026/07', gapMonth: '2026/08' },
      inputSnapshotId: 'input-1', inputHash: 'input-hash', calculationIds: { construction: 'c', funding: 'f' }, historySelectionId: 'history-1', calculationVersion: 'v', templateVersion: 't', createdAt: '2026-10-23T00:00:00.000Z', history: [],
      rows: [
        { rowId: 's:0:기초시재:0', sheet: '자금자료_정정', sourceRecordId: 'input-1', sourceKind: 'statement', fieldPath: 'statements[0].amounts.기초시재[0]', identityJson: { month: '2026/01', item: '기초시재' }, unit: '억원', originalValue: 1.0000000000000002, allowedActions: ['keep', 'set'], protectedCells: { note: '=2+2' } },
        { rowId: 's:0:기초시재:1', sheet: '자금자료_정정', sourceRecordId: 'input-1', sourceKind: 'statement', fieldPath: 'statements[0].amounts.기초시재[1]', identityJson: { month: '2026/02', item: '기초시재' }, unit: '억원', originalValue: -0.5, allowedActions: ['keep', 'set'], protectedCells: { note: '+SUM(A1:A2)' } },
      ],
    };
    const bytes = codec.historyWorkbookCodec.encode({ ...draft, structure: codec.historyWorkbookCodec.structure(draft as never) } as never);
    const book = XLSX.read(bytes, { type: 'array', cellFormula: true });
    expect(book.SheetNames).toEqual(['안내', '확정이력', '경제지표_정정', '자금자료_정정', '조달금리_정정', '_교환정보']);
    const cells = Object.values(book.Sheets['자금자료_정정']).filter((cell): cell is XLSX.CellObject => Boolean(cell && typeof cell === 'object' && 't' in cell));
    expect(cells.some(cell => cell.t === 's' && cell.v === '1.0000000000000002')).toBe(true);
    expect(cells.some(cell => cell.t === 's' && cell.v === '-0.5')).toBe(true);
    expect(cells.some(cell => typeof cell.v === 'string' && cell.v.startsWith('=') && cell.t === 's')).toBe(true);
    expect(cells.some(cell => typeof cell.v === 'string' && cell.v.startsWith('+') && cell.t === 's')).toBe(true);
    expect(cells.every(cell => !cell.f && !cell.F)).toBe(true);
    expect(codec.historyWorkbookCodec.readExportId(bytes)).toBe('22222222-2222-4222-8222-222222222222');
  });
});

it('여섯 시트의 헤더·보호/입력 열·고정 셀을 저장 명세에 고정해 재생성한다', () => {
  const codec = historyWorkbookCodec as unknown as { structure?: (manifest: unknown) => { sheets: { name: string; columns: { label: string; mode: string }[]; rows: string[][] }[] } };
  const row = { rowId: 'row-A', sheet: '자금자료_정정', sourceRecordId: 'input-1', sourceKind: 'statement', fieldPath: 'path',
    identityJson: { item: '기초시재', month: '2026/07' }, unit: '억원', originalValue: 0, allowedActions: ['keep','set'], protectedCells: { note: '고정 메모' } };
  const manifest = { ...base, rows: [row] };
  const structure = codec.structure?.(manifest);
  expect(structure?.sheets.map(sheet => sheet.name)).toEqual(['안내', '확정이력', '경제지표_정정', '자금자료_정정', '조달금리_정정', '_교환정보']);
  expect(structure?.sheets[3].columns.find(column => column.label === '수정 값')?.mode).toBe('editable');
  expect(structure?.sheets[3].columns.find(column => column.label === '기준값 · 읽기 전용')?.mode).toBe('protected');
  expect(structure?.sheets[3].rows[0]).toContain('0');
});

it('수정 행 9996개와 고정 20행을 합친 10016행은 발급 전에 거부한다', () => {
  const rows = Array.from({ length: 9996 }, (_, index) => ({ rowId: `row-${index}`, sheet: '자금자료_정정', sourceRecordId: 'input-1', sourceKind: 'statement', fieldPath: `path.${index}`,
    identityJson: { item: '기초시재', month: '2026/07' }, unit: '억원', originalValue: index, allowedActions: ['keep','set'], protectedCells: {} }));
  expect(() => historyWorkbookCodec.structure({ ...base, rows } as never)).toThrow('LIMIT_EXCEEDED');
});

it('저장한 여섯 시트 구조로 다시 인코딩하고 생성 필드가 바뀌어도 내용은 고정한다', () => {
  const draft = { ...base, rows: [], history: [{ kind: 'report-point', indicator: 'cash', month: '2026/08', value: '42' }] };
  const saved = { ...draft, structure: historyWorkbookCodec.structure(draft as never) };
  const first = historyWorkbookCodec.encode(saved as never);
  const again = historyWorkbookCodec.encode({ ...saved, result: [{ title: '뒤에 바뀐 값', value: '999' }], history: [] } as never);
  expect(again).toEqual(first);
  expect(() => historyWorkbookCodec.encode({ ...draft } as never)).toThrow('UNSUPPORTED_VERSION');
});

it('전체 시트의 문자열 2000자·비어 있지 않은 셀 200000개 제한을 적용한다', () => {
  expect(() => historyWorkbookCodec.structure({ ...base, rows: [], history: [{ kind: 'report-point', reason: 'x'.repeat(2001) }] } as never)).toThrow('LIMIT_EXCEEDED');
  const structure = historyWorkbookCodec.structure({ ...base, rows: [] } as never);
  const flooded = { sheets: structure.sheets.map((entry, index) => index === 1
    ? { ...entry, rows: Array.from({ length: 10_000 }, () => Array(24).fill('x')), columns: Array.from({ length: 24 }, (_, i) => ({ label: `C${i}`, mode: 'protected' as const })) }
    : { ...entry, rows: [] }) };
  expect(() => historyWorkbookCodec.encode({ ...base, rows: [], structure: flooded } as never)).toThrow('LIMIT_EXCEEDED');
});

it('조회 이력과 채권 이름은 한국어로 보여주되 원장 코드와 식별 JSON을 유지한다', () => {
  const history = [
    { kind: 'report-point', indicator: 'recovery', month: '2026/01', status: 'available', lineage: 'stored-document', value: '0' },
    { kind: 'report-point', indicator: 'liquidity', month: '2026/02', status: 'missing', lineage: 'stored-document' },
    { kind: 'report-point', indicator: 'cash', month: '2026/03', status: 'not-applicable', lineage: 'stored-document' },
    { kind: 'report-point', indicator: 'construction', month: '2026/04', status: 'available', lineage: 'live' },
    { kind: 'report-point', indicator: 'funding', month: '2026/05', status: 'available', lineage: 'reconstructed' },
    { kind: 'calculation', indicator: 'funding', month: '2026/05', origin: 'reconstructed' },
    { kind: 'confirmation-head', reportCycle: '2026/05', revision: 1 },
  ];
  const rows = ['publicAaa', 'treasury'].map(bond => ({ rowId: `kofia:${bond}`, sheet: '조달금리_정정', sourceRecordId: 'source', sourceKind: 'kofia', fieldPath: 'path',
    identityJson: { bond, date: '2026/05/31' }, unit: '%', originalValue: 3.674, allowedActions: ['keep', 'set'], protectedCells: {} }));
  const draft = { ...base, history, rows };
  const structure = historyWorkbookCodec.structure(draft as never);
  expect(structure.sheets[1].rows.map(row => [row[0], row[2], row[7], row[8]])).toEqual([
    ['조회값', '대금 회수 위험', '산출', '저장 문서'],
    ['조회값', '유동성 Gap', '결측', '저장 문서'],
    ['조회값', '적정 시재', '비적용', '저장 문서'],
    ['조회값', '건설경기 인식 지수', '산출', '단월 산출'],
    ['조회값', '조달위험 인식 지수', '산출', '과거 보완'],
    ['산출 출처', '조달위험 인식 지수', '', '과거 보완'],
    ['확정 기록', '', '', ''],
  ]);
  expect(structure.sheets[4].rows.map(row => row[1])).toEqual(['공사채 AAA 1년', '국고채 1년']);
  expect(structure.sheets[4].rows[0][15]).toContain('"bond":"publicAaa"');
  expect(history[0]).toMatchObject({ kind: 'report-point', indicator: 'recovery', status: 'available' });
  expect(rows[0].identityJson.bond).toBe('publicAaa');
});
