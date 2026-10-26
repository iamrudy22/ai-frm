import * as XLSX from 'xlsx';
import { inflateRawSync } from 'node:zlib';
import type { ExportRow, HistoryWorkbookCodec, StoredWorkbookExport, WorkbookExportWrite, WorkbookSheetStructure, WorkbookStructure } from '../../application/report-history/ports';

const SHEETS = ['안내', '확정이력', '경제지표_정정', '자금자료_정정', '조달금리_정정', '_교환정보'] as const;
const MAX_FILE = 5 * 1024 * 1024;
const MAX_UNCOMPRESSED = 25 * 1024 * 1024;
const fail = (code: string): never => { throw Error(code); };
const stringCell = (value: unknown): XLSX.CellObject => ({ t: 's', v: value === null || value === undefined ? '' : String(value) });
const header = (values: readonly string[]): XLSX.CellObject[] => values.map(stringCell);
const text = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value);
const indicatorNames: Readonly<Record<string, string>> = {
  recovery: '대금 회수 위험', liquidity: '유동성 Gap', construction: '건설경기 인식 지수',
  funding: '조달위험 인식 지수', cash: '적정 시재',
};
const historyKinds: Readonly<Record<string, string>> = { 'report-point': '조회값', calculation: '산출 출처', 'confirmation-head': '확정 기록' };
const historyStatuses: Readonly<Record<string, string>> = { available: '산출', missing: '결측', 'not-applicable': '비적용' };
const historyOrigins: Readonly<Record<string, string>> = { 'stored-document': '저장 문서', live: '단월 산출', reconstructed: '과거 보완' };
const bondNames: Readonly<Record<string, string>> = { publicAaa: '공사채 AAA 1년', treasury: '국고채 1년' };
const display = (value: unknown, names: Readonly<Record<string, string>>): unknown => typeof value === 'string' ? names[value] ?? value : value;

function table(headers: readonly string[], data: readonly (readonly string[])[]): XLSX.WorkSheet {
  const matrix = [header(headers), ...data.map(row => row.map(stringCell))];
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  sheet['!cols'] = headers.map((name, index) => ({ wch: index === 0 ? Math.max(20, name.length + 2) : 22 }));
  return sheet;
}

function editRows(rows: readonly ExportRow[]): readonly (readonly string[])[] {
  return rows.map(row => {
    const identity = row.identityJson as Record<string, unknown>;
    const agencies = (row.protectedCells as { byAgency?: Record<string, unknown> })?.byAgency;
    return [row.rowId, display(identity.indicator ?? identity.item ?? identity.bond ?? '', bondNames), identity.month ?? identity.date ?? '', row.unit,
      row.originalValue === null ? '' : row.originalValue.toString(), row.allowedActions.map(action => ({ keep: '유지', set: '값수정', 'set-missing': '결측처리' })[action]).join(' · '), '유지', '', '', '',
      (row.protectedCells as Record<string, unknown>)?.note ?? '', agencies?.['나이스피앤아이'] ?? '', agencies?.['한국자산평가'] ?? '', agencies?.['KIS자산평가'] ?? '',
      text(row.protectedCells), text(row.identityJson)].map(value => value === null || value === undefined ? '' : String(value));
  });
}

const EDIT_HEADER = ['행 ID', '원자료 항목', '월·평가일', '단위', '기준값 · 읽기 전용', '허용 동작', '수정 동작', '수정 값', '정정 사유', '근거 메모', '원천 메모 · 읽기 전용', '나이스피앤아이 · 읽기 전용', '한국자산평가 · 읽기 전용', 'KIS자산평가 · 읽기 전용', '원천 참고 · 읽기 전용', '식별 정보 · 읽기 전용'];
function sheet(name: WorkbookSheetStructure['name'], headers: readonly string[], rows: readonly (readonly unknown[])[], editable: readonly number[] = [], protectSheet = false, keyColumn: number | null = null): WorkbookSheetStructure {
  return { name, columns: headers.map((label, index) => ({ label, mode: editable.includes(index) ? 'editable' : 'protected' })),
    rows: rows.map(row => row.map(value => value === null || value === undefined ? '' : String(value))), protectSheet, keyColumn };
}

function structure(manifest: Omit<WorkbookExportWrite, 'structure'>): WorkbookStructure {
  if (manifest.workbookFormatVersion !== 1) fail('UNSUPPORTED_VERSION');
  const guide = sheet(SHEETS[0], ['정정용 엑셀 사용 안내', '내용'], [
    ['기준 확정본', `${manifest.basis.reportTitleMonth} · ${manifest.baseRevision}차`],
    ['수정 범위', '수정 동작·수정 값·정정 사유·근거 메모 칸만 편집합니다.'],
    ['유지', '수정 값을 비워 두고 기존 원값을 사용합니다.'],
    ['값수정', '유한한 숫자와 정정 사유를 입력합니다. 0은 실제 값입니다.'],
    ['결측처리', '경제지표 또는 조달금리 평균에만 허용됩니다.'],
    ['주의', '이 파일 저장만으로 서버의 확정본이나 원본 자금수지표는 바뀌지 않습니다.'],
  ], [], true);
  const history = manifest.history.map(entry => {
    const row = entry as Record<string, unknown>;
    return [display(row.kind ?? '', historyKinds), row.reportCycle ?? row.month ?? '', display(row.indicator ?? '', indicatorNames), row.value ?? '', row.secondary ?? '', row.unit ?? '', row.grade ?? '', display(row.status ?? '', historyStatuses),
      display(row.lineage ?? row.origin ?? '', historyOrigins), row.calculationId ?? row.confirmationId ?? '', row.reason ?? '', row.revision ?? ''];
  });
  const results = Array.isArray(manifest.result) ? manifest.result.map(entry => {
    const row = entry as Record<string, unknown>;
    return ['현재 결과', '', row.title ?? '', row.value ?? '', '', '', row.grade ?? '', row.status ?? '', '', '', row.formula ?? '', ''];
  }) : [];
  const historySheet = sheet(SHEETS[1], ['구분', '월', '지표 / 결과', '값', '보조값', '단위', '등급', '상태', '출처 유형', '기록 ID', '사유 / 산식', '확정 차수'], [...history, ...results], [], true);
  const editSheets = SHEETS.slice(2, 5).map(name => sheet(name, EDIT_HEADER, editRows(manifest.rows.filter(row => row.sheet === name)), [6, 7, 8, 9], false, 0));
  const metadata = sheet(SHEETS[5], ['교환 정보', '값'], [
    ['exportId', manifest.exportId], ['workbookFormatVersion', manifest.workbookFormatVersion], ['scopeId', manifest.scopeId],
    ['baseConfirmationId', manifest.baseConfirmationId], ['baseRevision', manifest.baseRevision], ['baseDocumentHash', manifest.baseDocumentHash],
    ['inputSnapshotId', manifest.inputSnapshotId], ['inputHash', manifest.inputHash], ['historySelectionId', manifest.historySelectionId],
    ['calculationVersion', manifest.calculationVersion], ['templateVersion', manifest.templateVersion], ['createdAt', manifest.createdAt],
    ['basis', text(manifest.basis)], ['result · 읽기 전용', text(manifest.result)],
  ], [], true);
  const result = { sheets: [guide, historySheet, ...editSheets, metadata] };
  validateStructure(result);
  return result;
}

function validateStructure(value: WorkbookStructure): void {
  if (!value || !Array.isArray(value.sheets) || value.sheets.length !== SHEETS.length || value.sheets.some((sheet, i) => sheet.name !== SHEETS[i] || !Array.isArray(sheet.columns) || !Array.isArray(sheet.rows))) fail('UNSUPPORTED_VERSION');
  let rows = 0, cells = 0;
  for (const sheet of value.sheets) {
    if (!sheet.columns.length || sheet.columns.length > 64 || sheet.columns.some(column => typeof column.label !== 'string' || !['protected', 'editable'].includes(column.mode))) fail('UNSUPPORTED_VERSION');
    if (sheet.rows.some(row => !Array.isArray(row) || row.length > sheet.columns.length)) fail('UNSUPPORTED_VERSION');
    rows += sheet.rows.length;
    for (const row of [sheet.columns.map(column => column.label), ...sheet.rows]) for (const cell of row) {
      if (typeof cell !== 'string' || cell.length > 2000) fail('LIMIT_EXCEEDED');
      if (cell.length > 0) cells++;
    }
  }
  if (rows > 10_000 || cells > 200_000) fail('LIMIT_EXCEEDED');
}

function encode(manifest: StoredWorkbookExport): Uint8Array {
  if (manifest.workbookFormatVersion !== 1 || !manifest.structure) fail('UNSUPPORTED_VERSION');
  validateStructure(manifest.structure);
  const wb = XLSX.utils.book_new();
  for (const entry of manifest.structure.sheets) {
    const worksheet = table(entry.columns.map(column => column.label), entry.rows);
    if (entry.protectSheet) worksheet['!protect'] = { password: 'aifrm' };
    XLSX.utils.book_append_sheet(wb, worksheet, entry.name);
  }
  const output = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true, bookSST: false }) as ArrayBuffer | Uint8Array;
  const bytes = output instanceof Uint8Array ? output : new Uint8Array(output);
  if (bytes.byteLength > MAX_FILE) fail('LIMIT_EXCEEDED');
  boundedZip(bytes);
  return bytes;
}

/** Small bounded ZIP gate for identification. Full cell-level validation belongs to Task 7. */
function boundedZip(bytes: Uint8Array): void {
  if (bytes.length > MAX_FILE || bytes.length < 22) fail('LIMIT_EXCEEDED');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50) fail('INVALID_WORKBOOK');
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) fail('INVALID_WORKBOOK');
  const count = view.getUint16(eocd + 10, true), centralSize = view.getUint32(eocd + 12, true), centralOffset = view.getUint32(eocd + 16, true);
  if (count > 128 || count === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) fail('LIMIT_EXCEEDED');
  if (centralOffset + centralSize > eocd) fail('INVALID_WORKBOOK');
  const names = new Set<string>(); let p = centralOffset, total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) fail('INVALID_WORKBOOK');
    const flags = view.getUint16(p + 8, true), method = view.getUint16(p + 10, true), packed = view.getUint32(p + 20, true), unpacked = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true), commentLen = view.getUint16(p + 32, true), local = view.getUint32(p + 42, true);
    if (flags & 1 || ![0, 8].includes(method) || packed === 0xffffffff || unpacked === 0xffffffff || local === 0xffffffff || p + 46 + nameLen + extraLen + commentLen > bytes.length) fail('INVALID_WORKBOOK');
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (names.has(name) || name.startsWith('/') || name.includes('..') || name.includes('\\') || name.includes(':')) fail('INVALID_WORKBOOK');
    names.add(name);
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 8, true) !== method) fail('INVALID_WORKBOOK');
    const localName = new TextDecoder().decode(bytes.subarray(local + 30, local + 30 + view.getUint16(local + 26, true)));
    if (name !== localName) fail('INVALID_WORKBOOK');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + packed > bytes.length || unpacked > MAX_UNCOMPRESSED - total) fail('LIMIT_EXCEEDED');
    const content = bytes.subarray(start, start + packed);
    let actual: Uint8Array;
    try { actual = method === 0 ? content : inflateRawSync(content, { maxOutputLength: MAX_UNCOMPRESSED - total }); }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ERR_BUFFER_TOO_LARGE') fail('LIMIT_EXCEEDED'); throw error; }
    if (actual.length !== unpacked) fail('INVALID_WORKBOOK');
    total += actual.length;
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (p !== centralOffset + centralSize) fail('INVALID_WORKBOOK');
}

function readExportId(bytes: Uint8Array): string {
  boundedZip(bytes);
  const wb = XLSX.read(bytes, { type: 'array', cellFormula: true, cellDates: false, bookVBA: false });
  if (wb.SheetNames.join('|') !== SHEETS.join('|')) fail('INVALID_WORKBOOK');
  const metadata = wb.Sheets[SHEETS[5]];
  if (metadata?.A2?.v !== 'exportId' || metadata.B2?.t !== 's' || typeof metadata.B2.v !== 'string' || !/^[0-9a-f-]{36}$/i.test(metadata.B2.v)) fail('INVALID_WORKBOOK');
  return metadata.B2.v;
}

export const historyWorkbookCodec: Pick<HistoryWorkbookCodec, 'structure' | 'encode' | 'readExportId'> = { structure, encode, readExportId };
