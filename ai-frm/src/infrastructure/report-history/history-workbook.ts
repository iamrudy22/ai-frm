import * as XLSX from 'xlsx';
import { inflateRawSync } from 'node:zlib';
import type { DecodedCorrection, WorkbookCellError, ExportRow, HistoryWorkbookCodec, StoredWorkbookExport, WorkbookExportWrite, WorkbookSheetStructure, WorkbookStructure } from '../../application/report-history/ports';

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
  return {
    name, columns: headers.map((label, index) => ({ label, mode: editable.includes(index) ? 'editable' : 'protected' })),
    rows: rows.map(row => row.map(value => value === null || value === undefined ? '' : String(value))), protectSheet, keyColumn
  };
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

/** Verify container sizes, local/central agreement and actual inflation before parsing OOXML. */
function boundedZip(bytes: Uint8Array): Map<string, string> {
  if (bytes.length > MAX_FILE || bytes.length < 22) fail('LIMIT_EXCEEDED');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50) fail('INVALID_WORKBOOK');
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) {
    eocd = i;
    break;
  }
  if (eocd < 0) fail('INVALID_WORKBOOK');
  const count = view.getUint16(eocd + 10, true), centralSize = view.getUint32(eocd + 12, true), centralOffset = view.getUint32(eocd + 16, true);
  if (count > 128 || count === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) fail('LIMIT_EXCEEDED');
  if (centralOffset + centralSize > eocd) fail('INVALID_WORKBOOK');
  const names = new Set<string>();
  const xml = new Map<string, string>();
  let p = centralOffset, total = 0;
  const regions: [number, number][] = [];
  if (view.getUint16(eocd + 4, true) || view.getUint16(eocd + 6, true) || view.getUint16(eocd + 8, true) !== count || eocd + 22 + view.getUint16(eocd + 20, true) !== bytes.length || centralOffset + centralSize !== eocd) fail('INVALID_WORKBOOK');
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) fail('INVALID_WORKBOOK');
    const flags = view.getUint16(p + 8, true), method = view.getUint16(p + 10, true), packed = view.getUint32(p + 20, true), unpacked = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true), commentLen = view.getUint16(p + 32, true), local = view.getUint32(p + 42, true);
    if (flags & ~0x808 || ![0, 8].includes(method) || packed === 0xffffffff || unpacked === 0xffffffff || local === 0xffffffff || p + 46 + nameLen + extraLen + commentLen > bytes.length) fail('INVALID_WORKBOOK');
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (!name || /vba|macro|externalLink|\.bin$/i.test(name) || names.has(name) || name.startsWith('/') || name.includes('..') || name.includes('\\') || name.includes(':')) fail('INVALID_WORKBOOK');
    names.add(name);
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 8, true) !== method) fail('INVALID_WORKBOOK');
    const localName = new TextDecoder().decode(bytes.subarray(local + 30, local + 30 + view.getUint16(local + 26, true)));
    if (name !== localName || view.getUint16(local + 6, true) !== flags) fail('INVALID_WORKBOOK');
    const checkExtra = (offset: number, length: number) => {
      const end = offset + length;
      while (offset < end) {
        if (offset + 4 > end) fail('INVALID_WORKBOOK');
        if (view.getUint16(offset, true) === 1) fail('INVALID_WORKBOOK');
        offset += 4 + view.getUint16(offset + 2, true);
      }
      if (offset !== end) fail('INVALID_WORKBOOK');
    };
    checkExtra(p + 46 + nameLen, extraLen);
    checkExtra(local + 30 + view.getUint16(local + 26, true), view.getUint16(local + 28, true));
    if (!(flags & 8) && (view.getUint32(local + 14, true) !== view.getUint32(p + 16, true) || view.getUint32(local + 18, true) !== packed || view.getUint32(local + 22, true) !== unpacked)) fail('INVALID_WORKBOOK');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + packed > centralOffset || unpacked > MAX_UNCOMPRESSED - total) fail('LIMIT_EXCEEDED');
    let end = start + packed;
    if (flags & 8) {
      if (end + 12 > centralOffset) fail('INVALID_WORKBOOK');
      if (view.getUint32(end, true) === 0x08074b50) end += 4;
      if (end + 12 > centralOffset || view.getUint32(end, true) !== view.getUint32(p + 16, true) || view.getUint32(end + 4, true) !== packed || view.getUint32(end + 8, true) !== unpacked) fail('INVALID_WORKBOOK');
      end += 12;
    }
    if (regions.some(([a, b]) => local < b && end > a)) fail('INVALID_WORKBOOK');
    regions.push([local, end]);
    const content = bytes.subarray(start, start + packed);
    let actual: Uint8Array;
    try { actual = method === 0 ? content : inflateRawSync(content, { maxOutputLength: Math.max(1, MAX_UNCOMPRESSED - total) }); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ERR_BUFFER_TOO_LARGE') fail('LIMIT_EXCEEDED');
      throw error;
    }
    if (actual.length > MAX_UNCOMPRESSED - total) fail('LIMIT_EXCEEDED');
    if (actual.length !== unpacked) fail('INVALID_WORKBOOK');
    let crc = 0xffffffff;
    for (const byte of actual) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(p + 16, true)) fail('INVALID_WORKBOOK');
    if (/\.(xml|rels)$/.test(name)) {
      let value: string;
      try { value = new TextDecoder('utf-8', { fatal: true }).decode(actual); } catch { return fail('INVALID_WORKBOOK'); }
      if (/<!DOCTYPE|<!ENTITY|<(?:[\w.-]+:)?external(?:Links?|References?)\b/i.test(value)) fail('INVALID_WORKBOOK');
      for (const tag of value.matchAll(/<(?:[\w.-]+:)?(?:Relationship|Override|Default)\b[^>]*>/g)) {
        const mode = attribute(tag[0], 'TargetMode');
        const type = attribute(tag[0], 'Type') ?? '';
        const contentType = attribute(tag[0], 'ContentType') ?? '';
        const target = attribute(tag[0], 'Target') ?? '';
        if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(target)) fail('INVALID_WORKBOOK');
        if (/relationships\/worksheet$/.test(type) && (name !== 'xl/_rels/workbook.xml.rels' || !/^(?:\/xl\/)?worksheets\/[^/]+\.xml$/.test(target))) fail('INVALID_WORKBOOK');
        if (/worksheet\+xml$/.test(contentType) && !/^\/xl\/worksheets\/[^/]+\.xml$/.test(attribute(tag[0], 'PartName') ?? '')) fail('INVALID_WORKBOOK');
        if (mode?.toLowerCase() === 'external' || /hyperlink|externalLink|vbaProject/i.test(type) || (/Override\b/.test(tag[0]) && /macroEnabled|vbaProject/i.test(contentType))) fail('INVALID_WORKBOOK');
      }
      xml.set(name, value);
    }
    total += actual.length;
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (p !== centralOffset + centralSize) fail('INVALID_WORKBOOK');
  inspectXml(xml);
  return xml;
}


const xmlValue = (value: string): string => value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, entity => {
  const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
  return named[entity] ?? String.fromCodePoint(entity.startsWith('&#x') ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1)));
});
const attribute = (tag: string, name: string): string | undefined => {
  const match = tag.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(["\'])(.*?)\\1', 's'));
  return match ? xmlValue(match[2]) : undefined;
};
/** Relationship identity must have one quoted, canonical attribute. SheetJS
 * aliases namespace/local names and does not XML-decode relationship values;
 * reject ambiguous encodings rather than inspect one target and parse another.
 */
function canonicalAttribute(tag: string, name: string, identity = true, optional = false): string {
  const localName = (key: string) => key.split(':').at(-1)!.split('_')[0].toLowerCase();
  const matches = [...tag.matchAll(/([^\s"'<>/=]+)\s*=\s*("[^"]*"|'[^']*'|[^\s"'<>`=]+)/g)]
    .filter(match => localName(match[1]) === localName(name));
  if (optional && matches.length === 0) return '';
  if (matches.length !== 1 || matches[0][1] !== name || !/^["']/.test(matches[0][2])) return fail('INVALID_WORKBOOK');
  const raw = matches[0][2].slice(1, -1), decoded = xmlValue(raw);
  if (!decoded || (identity && raw !== decoded)) return fail('INVALID_WORKBOOK');
  return decoded;
}
function address(value: string): void {
  if (!/^[A-Z]{1,3}[1-9][0-9]*$/.test(value)) fail('INVALID_WORKBOOK');
  const row = Number(value.match(/[0-9]+$/)![0]);
  const col = [...value.match(/^[A-Z]+/)![0]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  if (row > 10001 || col > 64) fail('LIMIT_EXCEEDED');
}

/** Match the installed SheetJS string decoder before it allocates cell strings.
 * OOXML escapes are decoded once, after rich-text runs have been joined; CDATA
 * remains literal. Length is the resulting JavaScript UTF-16 string length.
 */
function restoredCellText(value: string): string {
  const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
  const decode = (text: string) => text.replace(/&(?:quot|apos|gt|lt|amp|#x?([\da-fA-F]+));/ig,
    (entity: string, code: string) => named[entity] ?? String.fromCharCode(parseInt(code, entity.includes('x') ? 16 : 10)))
    .replace(/_x([\da-fA-F]{4})_/ig, (_match, code: string) => String.fromCharCode(parseInt(code, 16)));
  let result = '', offset = 0;
  for (const match of value.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    result += decode(value.slice(offset, match.index)) + match[1];
    offset = match.index + match[0].length;
  }
  return result + decode(value.slice(offset));
}

function restoredRichText(value: string): string {
  // SheetJS treats a leading <t> as plain text and excludes phonetic runs from
  // rich strings. Join encoded runs first (an escape can cross run boundaries).
  if (/^\s*<(?:\w+:)?t[^>]*>/.test(value)) {
    return restoredCellText(value.slice(value.indexOf('>') + 1).split(/<\/(?:\w+:)?t>/)[0]);
  }
  if (!/<(?:\w+:)?r>/.test(value)) return '';
  const withoutPhonetics = value.replace(/<(?:\w+:)?rPh.*?>([\s\S]*?)<\/(?:\w+:)?rPh>/g, '');
  const runs = [...withoutPhonetics.matchAll(/<(?:\w+:)?t[^>]*>([^<]*)<\/(?:\w+:)?t>/g)].map(match => match[1]);
  return restoredCellText(runs.join(''));
}

function assertTextLimit(value: string): void {
  if (value.length > 2000) fail('LIMIT_EXCEEDED');
}

function inspectXml(xml: Map<string, string>): void {
  if (!xml.has('[Content_Types].xml') || !xml.has('xl/workbook.xml')) fail('INVALID_WORKBOOK');
  const worksheets = [...xml].filter(([name]) => /^xl\/worksheets\/[^/]+\.xml$/.test(name));
  if (worksheets.length !== 6) fail('INVALID_WORKBOOK');
  const sheets = [...xml.get('xl/workbook.xml')!.matchAll(/<(?:[\w.-]+:)?sheet\b[^>]*>/g)].map(tag => tag[0]);
  const names = sheets.map(tag => canonicalAttribute(tag, 'name', false));
  if (names.length !== 6 || names.sort().join('|') !== [...SHEETS].sort().join('|')) fail('INVALID_WORKBOOK');
  const workbookRels = xml.get('xl/_rels/workbook.xml.rels') ?? fail('INVALID_WORKBOOK');
  const relationships = new Map<string, { type: string; target: string }>();
  for (const match of workbookRels.matchAll(/<(?:[\w.-]+:)?Relationship\b[^>]*>/g)) {
    const id = canonicalAttribute(match[0], 'Id'), type = canonicalAttribute(match[0], 'Type'), target = canonicalAttribute(match[0], 'Target');
    if (relationships.has(id)) fail('INVALID_WORKBOOK');
    relationships.set(id, { type, target });
  }
  const parts = new Set(worksheets.map(([name]) => name)), usedParts = new Set<string>();
  for (const sheet of sheets) {
    const id = canonicalAttribute(sheet, 'r:id');
    const relationship = relationships.get(id) ?? fail('INVALID_WORKBOOK');
    if (!/\/relationships\/worksheet$/.test(relationship.type)) fail('INVALID_WORKBOOK');
    const part = relationship.target.startsWith('/') ? relationship.target.slice(1) : 'xl/' + relationship.target;
    if (!parts.has(part) || usedParts.has(part)) fail('INVALID_WORKBOOK');
    usedParts.add(part);
  }
  if (usedParts.size !== parts.size) fail('INVALID_WORKBOOK');
  let rows = 0, cells = 0;
  for (const [, value] of xml) {
    for (const match of value.matchAll(/<(?:\w+:)?(?:si|sstItem)\b[^>]*>([\s\S]*?)<\/(?:\w+:)?(?:si|sstItem)>/g)) assertTextLimit(restoredRichText(match[1].trim()));
  }
  for (const [, value] of worksheets) {
    if (/<(?:[\w.-]+:)?(?:f|hyperlink)(?:\s|\/?>)/i.test(value)) fail('INVALID_WORKBOOK');
    const addresses = new Set<string>();
    for (const ref of value.matchAll(/\b(?:ref|sqref)\s*=\s*(["'])(.*?)\1/g)) for (const range of xmlValue(ref[2]).split(/\s+/)) for (const part of range.split(':')) address(part);
    for (const dimension of value.matchAll(/<(?:\w+:)?dimension\b[^>]*>/g)) for (const part of (attribute(dimension[0], 'ref') ?? '').split(':')) address(part);
    for (const row of value.matchAll(/<(?:\w+:)?row\b[^>]*>/g)) {
      const r = Number(attribute(row[0], 'r'));
      if (!Number.isSafeInteger(r) || r < 1 || r > 10001) fail('LIMIT_EXCEEDED');
      if (r > 1) rows++;
    }
    for (const cell of value.matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const ref = canonicalAttribute(cell[1], 'r');
      address(ref);
      if (addresses.has(ref)) fail('INVALID_WORKBOOK');
      addresses.add(ref);
      cells++;
      const type = canonicalAttribute(cell[1], 't', true, true);
      if (!['', 'n', 'str', 's', 'inlineStr', 'z'].includes(type)) fail('INVALID_WORKBOOK');
      const raw = (cell[2] ?? '').match(/<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
      // For t=str SheetJS decodes escapes in the XML byte string before UTF-8;
      // inline/shared strings do those steps in the opposite order.
      if (type === 'str') assertTextLimit(Buffer.from(restoredCellText(Buffer.from(raw ?? '', 'utf8').toString('latin1')), 'latin1').toString('utf8'));
      if (type === 'inlineStr') {
        const inline = (cell[2] ?? '').match(/<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/)?.[1] ?? '';
        assertTextLimit(restoredRichText(inline));
      }
      if ((!type || type === 'n') && raw !== undefined && (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(raw) || !Number.isFinite(Number(raw)) || (Number(raw) === 0 && /[1-9]/.test(raw.split(/[eE]/)[0])))) fail('INVALID_WORKBOOK');
    }
  }
  if (rows > 10000 || cells > 200000) fail('LIMIT_EXCEEDED');
}

function readExportId(bytes: Uint8Array, reader: typeof XLSX.read = XLSX.read): string {
  boundedZip(bytes);
  const wb = reader(bytes, { type: 'array', cellFormula: true, cellDates: false, cellNF: true, cellHTML: false, bookVBA: false });
  if (wb.SheetNames.length !== SHEETS.length || [...wb.SheetNames].sort().join('|') !== [...SHEETS].sort().join('|')) fail('INVALID_WORKBOOK');
  const metadata = wb.Sheets[SHEETS[5]];
  const keys = Object.keys(metadata).filter(key => /^A[2-9][0-9]*$|^A1[0-9]+$/.test(key) && metadata[key]?.v === 'exportId');
  if (keys.length !== 1) return fail('INVALID_WORKBOOK');
  const cell = metadata['B' + keys[0].slice(1)];
  if (cell?.t !== 's' || typeof cell.v !== 'string' || !/^[0-9a-f-]{36}$/i.test(cell.v)) return fail('INVALID_WORKBOOK');
  return cell.v;
}

function decode(bytes: Uint8Array, manifest: StoredWorkbookExport, reader: typeof XLSX.read = XLSX.read): DecodedCorrection {
  validateStructure(manifest.structure);
  const errors: WorkbookCellError[] = [];
  const patch: DecodedCorrection['patch'][number][] = [];
  const error = (sheet: string | null, row: number | null, column: number | null, code: string) => errors.push({ sheet, row, column: column === null ? null : XLSX.utils.encode_col(column), code, message: ({ PROTECTED_CELL: '읽기 전용 값이 기준 기록과 다릅니다.', INVALID_NUMBER: '유한한 일반 십진수를 입력하세요.', INVALID_ACTION: '허용된 동작을 선택하세요.', REQUIRED_REASON: '사유를 입력하세요.', KEEP_NOT_EMPTY: '유지 행의 입력 칸을 비워 주세요.', ROW_MISMATCH: '행 식별자가 기준 기록과 다릅니다.', INVALID_CELL: '허용되지 않은 셀 형식입니다.' } as Record<string, string>)[code] ?? '파일 구조를 확인하세요.' });
  let wb: XLSX.WorkBook;
  try {
    const id = readExportId(bytes, reader);
    if (id !== manifest.exportId) {
      error(null, null, null, 'ROW_MISMATCH');
      return { patch: [], errors };
    }
    wb = reader(bytes, { type: 'array', cellFormula: true, cellNF: true, cellDates: false, cellHTML: false });
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'LIMIT_EXCEEDED') throw cause;
    error(null, null, null, 'INVALID_CELL');
    return { patch: [], errors };
  }
  for (const spec of manifest.structure.sheets) {
    const actual = wb.Sheets[spec.name];
    const cellAt = (r: number, c: number): XLSX.CellObject | undefined => actual[XLSX.utils.encode_cell({ r, c })];
    const valueAt = (r: number, c: number): string => {
      const cell = cellAt(r, c);
      return cell?.v === undefined || cell.v === null ? '' : String(cell.v);
    };
    const expectedRows = new Map(spec.rows.map((row, i) => [spec.keyColumn === null ? String(i) : row[spec.keyColumn], row]));
    const protectedOrder = new Map<string, string[]>();
    if (spec.keyColumn === null) spec.rows.forEach((row, index) => {
      const signature = JSON.stringify(spec.columns.map((_, c) => row[c] ?? ''));
      protectedOrder.set(signature, [...(protectedOrder.get(signature) ?? []), String(index)]);
    });
    const seen = new Set<string>();
    const occupied = new Set<number>();
    for (const key of Object.keys(actual).filter(key => !key.startsWith('!'))) {
      const { r, c } = XLSX.utils.decode_cell(key), cell = actual[key] as XLSX.CellObject;
      if (cell.v !== undefined && cell.v !== null && cell.v !== '') occupied.add(r);
      if (c >= spec.columns.length) error(spec.name, r + 1, c, 'PROTECTED_CELL');
      const format = typeof cell.z === 'string' ? cell.z : '';
      if (cell.f !== undefined || cell.F !== undefined || cell.l || !['s', 'str', 'n', 'z'].includes(cell.t) || XLSX.SSF.is_date(format) || /%/.test(format.replace(/"[^"]*"|\\./g, '')) || (typeof cell.v === 'number' && !Number.isFinite(cell.v))) error(spec.name, r + 1, c, 'INVALID_CELL');
      if (typeof cell.v === 'string' && cell.v.length > 2000) fail('LIMIT_EXCEEDED');
    }
    spec.columns.forEach((col, c) => { if (valueAt(0, c) !== col.label) error(spec.name, 1, c, 'PROTECTED_CELL'); });
    for (const r of [...occupied].filter(r => r > 0).sort((a, b) => a - b)) {
      const key = spec.keyColumn === null ? protectedOrder.get(JSON.stringify(spec.columns.map((_, c) => valueAt(r, c))))?.shift() ?? '' : valueAt(r, spec.keyColumn);
      const expected = expectedRows.get(key);
      if (!expected || seen.has(key)) {
        error(spec.name, r + 1, spec.keyColumn, 'ROW_MISMATCH');
        continue;
      }
      seen.add(key);
      spec.columns.forEach((col, c) => { if (col.mode === 'protected' && valueAt(r, c) !== (expected[c] ?? '')) error(spec.name, r + 1, c, 'PROTECTED_CELL'); });
      if (spec.keyColumn === null) continue;
      const row = manifest.rows.find(row => row.rowId === key && row.sheet === spec.name);
      if (!row) {
        error(spec.name, r + 1, 0, 'ROW_MISMATCH');
        continue;
      }
      const action = ({ '유지': 'keep', '값수정': 'set', '결측처리': 'set-missing' } as const)[valueAt(r, 6) as '유지'];
      const reason = valueAt(r, 8).trim(), evidenceNote = valueAt(r, 9).trim(), raw = valueAt(r, 7);
      if (!action || !row.allowedActions.includes(action)) {
        error(spec.name, r + 1, 6, 'INVALID_ACTION');
        continue;
      }
      if (action === 'keep') {
        if (raw !== '' || reason !== '' || evidenceNote !== '') error(spec.name, r + 1, 7, 'KEEP_NOT_EMPTY');
        continue;
      }
      if (!reason) error(spec.name, r + 1, 8, 'REQUIRED_REASON');
      let value: number | null = null;
      if (action === 'set') {
        const cell = cellAt(r, 7);
        if (!raw || (cell?.t !== 'n' && !/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(raw)) || !Number.isFinite(Number(raw)) || (Number(raw) === 0 && /[1-9]/.test(raw.split(/[eE]/)[0]))) {
          error(spec.name, r + 1, 7, 'INVALID_NUMBER');
          continue;
        }
        value = Number(raw);
      } else if (raw !== '') {
        error(spec.name, r + 1, 7, 'INVALID_NUMBER');
        continue;
      }
      if (value !== row.originalValue) patch.push({ rowId: row.rowId, action, value, reason, evidenceNote });
    }
    if (seen.size !== expectedRows.size) error(spec.name, null, spec.keyColumn, 'ROW_MISMATCH');
  }
  return { patch: errors.length ? [] : patch.sort((a, b) => a.rowId.localeCompare(b.rowId)), errors };
}

export function createHistoryWorkbookCodec(reader: typeof XLSX.read = XLSX.read): HistoryWorkbookCodec {
  return { structure, encode, readExportId: bytes => readExportId(bytes, reader), decode: (bytes, manifest) => decode(bytes, manifest, reader) };
}
export const historyWorkbookCodec = createHistoryWorkbookCodec();
