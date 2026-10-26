import { inflateRawSync, deflateRawSync, crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { historyWorkbookCodec, createHistoryWorkbookCodec } from './history-workbook';

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

function correctionFixture() {
  const draft = { ...base, rows: [{ rowId: 'row-A', sheet: '자금자료_정정', sourceRecordId: 'input-1', sourceKind: 'statement', fieldPath: 'path', identityJson: { item: '기초시재', month: '2026/07' }, unit: '억원', originalValue: 12, allowedActions: ['keep', 'set'], protectedCells: {} }] };
  return { ...draft, structure: historyWorkbookCodec.structure(draft as never) } as unknown as import('../../application/report-history/ports').StoredWorkbookExport;
}
function editWorkbook(edit: (book: XLSX.WorkBook) => void) {
  const manifest = correctionFixture();
  const book = XLSX.read(historyWorkbookCodec.encode(manifest), { type: 'array' });
  edit(book);
  return { manifest, bytes: new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true })) };
}

it('import_rejects_untrusted_structure: 수식 캐시값이 있어도 식별 단계에서 거부한다', () => {
  const { bytes } = editWorkbook(book => { book.Sheets['자금자료_정정'].H2 = { t: 'n', v: 42, f: '21*2' }; });
  expect(() => historyWorkbookCodec.readExportId(bytes)).toThrow('INVALID_WORKBOOK');
});
it('import_bounds_before_parse: 먼 셀 주소는 작은 파일이어도 식별 전에 거부한다', () => {
  const { bytes } = editWorkbook(book => { book.Sheets['자금자료_정정'].A10002 = { t: 's', v: 'x' }; book.Sheets['자금자료_정정']['!ref'] = 'A1:P10002'; });
  expect(() => historyWorkbookCodec.readExportId(bytes)).toThrow('LIMIT_EXCEEDED');
});
it('논리 시트 순서만 달라도 같은 서버 exportId를 식별한다', () => {
  const { bytes, manifest } = editWorkbook(book => { book.SheetNames.reverse(); });
  expect(historyWorkbookCodec.readExportId(bytes)).toBe(manifest.exportId);
});

const decodeCorrection = (bytes: Uint8Array, manifest: import('../../application/report-history/ports').StoredWorkbookExport) =>
  (historyWorkbookCodec as Partial<import('../../application/report-history/ports').HistoryWorkbookCodec>).decode?.(bytes, manifest);
it('import_unchanged_is_noop: 무수정 파일과 같은 수를 set한 파일은 빈 patch다', () => {
  for (const modified of [false,true]) {
    const { bytes, manifest } = editWorkbook(book => { if (modified) Object.assign(book.Sheets['자금자료_정정'], { G2: { t: 's', v: '값수정' }, H2: { t: 'n', v: 12 }, I2: { t: 's', v: '확인' } }); });
    expect(decodeCorrection(bytes,manifest)).toEqual({ patch: [], errors: [] });
  }
});
it('set 0은 실제 숫자이며 사유를 trim하여 전체 정밀도로 전달한다', () => {
  const { bytes, manifest } = editWorkbook(book => Object.assign(book.Sheets['자금자료_정정'], { G2: { t: 's', v: '값수정' }, H2: { t: 'n', v: 0 }, I2: { t: 's', v: '  수정 사유  ' } }));
  expect(decodeCorrection(bytes,manifest)).toEqual({ patch: [{ rowId: 'row-A', action: 'set', value: 0, reason: '수정 사유', evidenceNote: '' }], errors: [] });
});
it.each(['', '1e3', '1,000', '1%', ' 1', '1e-999', '9'.repeat(400)])('수정 텍스트 %s는 허용 십진수만 받아 전체 patch를 거부한다', value => {
  const { bytes, manifest } = editWorkbook(book => Object.assign(book.Sheets['자금자료_정정'], { G2: { t: 's', v: '값수정' }, H2: { t: 's', v: value }, I2: { t: 's', v: '사유' } }));
  const result = decodeCorrection(bytes,manifest);
  expect(result?.patch).toEqual([]); expect(result?.errors).toEqual(expect.arrayContaining([expect.objectContaining({ sheet: '자금자료_정정', row: 2, column: 'H' })]));
});
it.each(['keep-value','unit','missing-row','duplicate-row','extra-row','bad-action','missing-reason','percent','date'])('변조 %s는 오류 위치만 반환하고 부분 patch는 없다', kind => {
  const { bytes, manifest } = editWorkbook(book => {
    const s = book.Sheets['자금자료_정정'];
    Object.assign(s, { G2: { t: 's', v: '값수정' }, H2: { t: 'n', v: 0 }, I2: { t: 's', v: '수정' } });
    if (kind === 'keep-value') s.G2.v = '유지';
    if (kind === 'unit') s.D2.v = '원';
    if (kind === 'missing-row') delete s.A2;
    if (kind === 'duplicate-row' || kind === 'extra-row') { for (let c = 0; c < 16; c++) s[XLSX.utils.encode_cell({r:2,c})] = {...s[XLSX.utils.encode_cell({r:1,c})]}; if (kind === 'extra-row') s.A3.v = 'new'; s['!ref'] = 'A1:P3'; }
    if (kind === 'bad-action') s.G2.v = '추가';
    if (kind === 'missing-reason') s.I2.v = '';
    if (kind === 'percent') s.H2.z = '0.00%';
    if (kind === 'date') s.H2.z = 'yyyy-mm-dd';
  });
  const result = decodeCorrection(bytes,manifest);
  expect(result?.patch).toEqual([]); expect(result?.errors.length).toBeGreaterThan(0);
  expect(JSON.stringify(result?.errors)).not.toContain('수정');
});

function unpack(bytes:Uint8Array):[string,Buffer][] {
  const b=Buffer.from(bytes), result:[string,Buffer][]=[];let p=0;
  while(b.readUInt32LE(p)===0x04034b50) {const n=b.readUInt16LE(p+26),e=b.readUInt16LE(p+28),size=b.readUInt32LE(p+18),start=p+30+n+e;const data=b.subarray(start,start+size);result.push([b.subarray(p+30,p+30+n).toString(),b.readUInt16LE(p+8)===8?inflateRawSync(data):data]);p=start+size;}
  return result;
}
function zip(entries:readonly [string,Buffer][],compression=false):Uint8Array {
  const locals:Buffer[]=[],centrals:Buffer[]=[];let offset=0;
  for(const [name,data] of entries) {const n=Buffer.from(name),content=compression?deflateRawSync(data):data;const l=Buffer.alloc(30),c=Buffer.alloc(46);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(compression?8:0,8);l.writeUInt32LE(crc32(data),14);l.writeUInt32LE(content.length,18);l.writeUInt32LE(data.length,22);l.writeUInt16LE(n.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(compression?8:0,10);c.writeUInt32LE(crc32(data),16);c.writeUInt32LE(content.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);locals.push(l,n,content);centrals.push(c,n);offset+=l.length+n.length+content.length;}
  const cd=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,cd,end]);
}
it.each(['shared-formula','prefix-formula','date-type','numeric-tail','numeric-overflow','numeric-underflow','external','macro','doctype','text-limit','dimension','duplicate','traversal','zip64','encrypted'])('bounded OOXML %s를 SheetJS 없이 거부한다',async kind=>{
  const manifest=correctionFixture(),entries=unpack(historyWorkbookCodec.encode(manifest));
  const sheet=entries.find(e=>e[0]==='xl/worksheets/sheet4.xml')!;
  const cells:Record<string,string>={'shared-formula':'<c r="H2"><f t="shared" si="0"/><v>1</v></c>','prefix-formula':'<c r="H2"><x:f xmlns:x="urn:test"/><v>1</v></c>','date-type':'<c r="H2" t="d"><v>2026-01-01</v></c>','numeric-tail':'<c r="H2"><v>12garbage</v></c>','numeric-overflow':'<c r="H2"><v>1e999</v></c>','numeric-underflow':'<c r="H2"><v>1e-999</v></c>','text-limit':`<c r="H2" t="inlineStr"><is><t>${'x'.repeat(2001)}</t></is></c>`};
  if(cells[kind])sheet[1]=Buffer.from(sheet[1].toString().replace(/<c r="H2"[\s\S]*?<\/c>/,cells[kind]));
  if(kind==='external')entries.push(['xl/_rels/external.xml.rels',Buffer.from('<Relationships><Relationship TargetMode="External" Target="https://example.test"/></Relationships>')]);
  if(kind==='macro')entries.push(['xl/vbaProject.bin',Buffer.from('macro')]);
  if(kind==='doctype')sheet[1]=Buffer.from('<!DOCTYPE worksheet [<!ENTITY x "x">]>'+sheet[1].toString());
  if(kind==='dimension')sheet[1]=Buffer.from(sheet[1].toString().replace(/<dimension[^>]*>/,'<dimension ref="A1:XFD1048576"/>'));
  if(kind==='duplicate')entries.push(entries[0]);if(kind==='traversal')entries.push(['../escape',Buffer.from('x')]);
  const bytes=Buffer.from(zip(entries));if(kind==='zip64')bytes.writeUInt32LE(0xffffffff,bytes.length-6);if(kind==='encrypted')bytes.writeUInt16LE(1,6);
  let calls=0;
  const guarded=createHistoryWorkbookCodec((...args)=>{calls++;return XLSX.read(...args);});
  expect(()=>guarded.readExportId(bytes)).toThrow();expect(calls).toBe(0);
});
it('actual inflate 25MiB와 ZIP 128개 상한, 압축 파일 5MiB 상한을 실제 해제 전에 검사한다',()=>{
  const entries=unpack(historyWorkbookCodec.encode(correctionFixture()));
  expect(()=>historyWorkbookCodec.readExportId(zip([...entries,['padding',Buffer.alloc(25*1024*1024)]],true))).toThrow('LIMIT_EXCEEDED');
  expect(()=>historyWorkbookCodec.readExportId(zip([...entries,...Array.from({length:129},(_,i)=>[`extra${i}`,Buffer.alloc(0)] as [string,Buffer])]))).toThrow('LIMIT_EXCEEDED');
  expect(()=>historyWorkbookCodec.readExportId(new Uint8Array(5*1024*1024+1))).toThrow('LIMIT_EXCEEDED');
});

it('XML entity로 숨긴 외부 관계도 파서 전에 차단하고 일반 메모 문자열은 허용한다',()=>{
  const manifest=correctionFixture(),entries=unpack(historyWorkbookCodec.encode(manifest));
  entries.push(['xl/_rels/custom.xml.rels',Buffer.from('<Relationships><Relationship TargetMode="&#x45;xternal" Target="https://example.test"/></Relationships>')]);
  let calls=0;const codec=createHistoryWorkbookCodec((...args)=>{calls++;return XLSX.read(...args);});
  expect(()=>codec.readExportId(zip(entries))).toThrow('INVALID_WORKBOOK');expect(calls).toBe(0);
  const {bytes}=editWorkbook(book=>{book.Sheets['자금자료_정정'].J2={t:'s',v:'externalLink와 vbaProject는 이 메모의 일반 문자열'};});
  expect(historyWorkbookCodec.readExportId(bytes)).toBe(manifest.exportId);
});

it('압축 5MiB·실제 해제25MiB·ZIP128항목 경계는 통과하고 초과는 파서 호출 0이다',()=>{
  const original=unpack(historyWorkbookCodec.encode(correctionFixture()));
  const assertGate=(entries:[string,Buffer][],compressed:boolean,ok:boolean)=>{let calls=0;const codec=createHistoryWorkbookCodec((...args)=>{calls++;return XLSX.read(...args);});const run=()=>codec.readExportId(zip(entries,compressed));if(ok){expect(run()).toBe(base.exportId);expect(calls).toBe(1);}else{expect(run).toThrow('LIMIT_EXCEEDED');expect(calls).toBe(0);}};
  const overhead=zip([...original,['padding',Buffer.alloc(0)]]).length;
  assertGate([...original,['padding',Buffer.alloc(5*1024*1024-overhead)]],false,true);
  assertGate([...original,['padding',Buffer.alloc(5*1024*1024-overhead+1)]],false,false);
  const total=original.reduce((sum,[,content])=>sum+content.length,0);
  assertGate([...original,['padding',Buffer.alloc(25*1024*1024-total)]],true,true);
  assertGate([...original,['padding',Buffer.alloc(25*1024*1024-total+1)]],true,false);
  assertGate([...original,...Array.from({length:128-original.length},(_,i)=>[`extra${i}`,Buffer.alloc(0)] as [string,Buffer])],true,true);
  assertGate([...original,...Array.from({length:129-original.length},(_,i)=>[`extra${i}`,Buffer.alloc(0)] as [string,Buffer])],true,false);
},15000);
it('데이터행 10000·실제셀 200000·텍스트2000 경계와 초과를 파서 전에 구분한다',()=>{
  const baseEntries=unpack(historyWorkbookCodec.encode(correctionFixture()));
  const otherCells=baseEntries.filter(([name])=>/xl\/worksheets\//.test(name)&&!name.endsWith('sheet4.xml')).reduce((sum,[,xml])=>sum+[...xml.toString().matchAll(/<c\b/g)].length,0);
  for(const [kind,limit] of [['rows',10000],['cells',200000],['text',2000]] as const) for(const extra of [0,1]){
    const entries=baseEntries.map(([name,data])=>[name,Buffer.from(data)] as [string,Buffer]);const target=entries.find(([name])=>name==='xl/worksheets/sheet4.xml')!;
    const count=kind==='rows'?limit+extra-20+1:kind==='cells'?limit+extra-otherCells:1;
    const perRow=kind==='cells'?64:1;const rows:string[]=[];
    for(let i=0;i<count;i+=perRow){const r=Math.floor(i/perRow)+1;const cells=Array.from({length:Math.min(perRow,count-i)},(_,c)=>`<c r="${XLSX.utils.encode_col(c)}${r}" t="inlineStr"><is><t>${kind==='text'?'x'.repeat(limit+extra):'1'}</t></is></c>`).join('');rows.push(`<row r="${r}">${cells}</row>`);}
    target[1]=Buffer.from(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`);
    let calls=0;const codec=createHistoryWorkbookCodec((...args)=>{calls++;return XLSX.read(...args);});const run=()=>codec.readExportId(zip(entries,true));
    if(extra){expect(run,kind).toThrow('LIMIT_EXCEEDED');expect(calls).toBe(0);}else{expect(run(),kind).toBe(base.exportId);expect(calls).toBe(1);}
  }
},15000);
it('worksheet 관계 우회와 병합 범위 확장도 파서 전에 거부한다',()=>{
  for(const attack of ['relationship','merge']){
    const entries=unpack(historyWorkbookCodec.encode(correctionFixture()));
    if(attack==='relationship'){
      const relations=entries.find(([name])=>name==='xl/_rels/workbook.xml.rels')!;relations[1]=Buffer.from(relations[1].toString().replace('worksheets/sheet4.xml','custom.xml'));
      entries.push(['xl/custom.xml',Buffer.from('<worksheet><sheetData><row r="1"><c r="A1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>')]);
    }else{const sheet=entries.find(([name])=>name==='xl/worksheets/sheet4.xml')!;sheet[1]=Buffer.from(sheet[1].toString().replace('</worksheet>','<mergeCells><mergeCell ref="A1:XFD1048576"/></mergeCells></worksheet>'));}
    let calls=0;const codec=createHistoryWorkbookCodec((...args)=>{calls++;return XLSX.read(...args);});expect(()=>codec.readExportId(zip(entries))).toThrow();expect(calls).toBe(0);
  }
});
it('보호 정보도 행 순서만 바뀌면 동일 명세로 식별하며 수치·서식 변경 없이 no-change다',()=>{
  const {bytes,manifest}=editWorkbook(book=>{
    const metadata=book.Sheets._교환정보;for(const col of ['A','B']){const first=metadata[`${col}2`];metadata[`${col}2`]=metadata[`${col}3`];metadata[`${col}3`]=first;}
    const guide=book.Sheets.안내;for(const col of ['A','B']){const first=guide[`${col}2`];guide[`${col}2`]=guide[`${col}3`];guide[`${col}3`]=first;}
  });
  expect(historyWorkbookCodec.readExportId(bytes)).toBe(manifest.exportId);expect(historyWorkbookCodec.decode(bytes,manifest)).toEqual({patch:[],errors:[]});
});

it('ZIP 메타데이터가 해제 크기를 작게 속여도 실제 inflate 상한에서 파서를 호출하지 않는다', () => {
  const entries = unpack(historyWorkbookCodec.encode(correctionFixture()));
  const bytes = Buffer.from(zip([...entries, ['padding', Buffer.alloc(26 * 1024 * 1024)]], true));
  const centralStart = bytes.readUInt32LE(bytes.length - 6);
  let cursor = centralStart;
  while (bytes.readUInt32LE(cursor) === 0x02014b50) {
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString();
    if (name === 'padding') {
      const local = bytes.readUInt32LE(cursor + 42);
      bytes.writeUInt32LE(1, cursor + 24);
      bytes.writeUInt32LE(1, local + 22);
      break;
    }
    cursor += 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
  }
  let calls = 0;
  const codec = createHistoryWorkbookCodec((...args) => { calls++; return XLSX.read(...args); });
  expect(() => codec.readExportId(bytes)).toThrow();
  expect(calls).toBe(0);
});

it.each(['str', 'inline', 'shared'])('복원된 %s 셀 문자열 2000/2001자를 SheetJS 전에 구분한다', kind => {
  for (const encoded of [false, true]) for (const length of [2000, 2001]) {
    const entries = unpack(historyWorkbookCodec.encode(correctionFixture()));
    const sheet = entries.find(([name]) => name === 'xl/worksheets/sheet4.xml')!;
    const text = (encoded ? 'A&'.repeat(1000) : '가'.repeat(2000)) + (length === 2001 ? 'B' : '');
    const escape = (value: string) => encoded ? value.replace(/A/g, '_x0041_').replace(/&/g, '&amp;') : value;
    const rich = `<r><t>${escape(text.slice(0,1001))}</t></r><r><t>${escape(text.slice(1001))}</t></r>`;
    const cell = kind === 'str' ? `<c r="H2" t="str"><v>${escape(text)}</v></c>` : kind === 'inline' ? `<c r="H2" t="inlineStr"><is>${rich}</is></c>` : '<c r="H2" t="s"><v>0</v></c>';
    sheet[1] = Buffer.from(sheet[1].toString().replace(/<c r="H2"[\s\S]*?<\/c>/, cell));
    if (kind === 'shared') {
      entries.push(['xl/sharedStrings.xml', Buffer.from(`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si>${rich}</si></sst>`)]);
      const contentTypes = entries.find(([name]) => name === '[Content_Types].xml')!;
      contentTypes[1] = Buffer.from(contentTypes[1].toString().replace('</Types>', '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'));
      const rels = entries.find(([name]) => name === 'xl/_rels/workbook.xml.rels')!;
      rels[1] = Buffer.from(rels[1].toString().replace('</Relationships>', '<Relationship Id="rId100" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'));
    }
    let calls = 0, actual: unknown;
    const codec = createHistoryWorkbookCodec((...args) => { calls++; const book = XLSX.read(...args); actual = book.Sheets['자금자료_정정'].H2.v; return book; });
    const run = () => codec.readExportId(zip(entries, true));
    if (length === 2000) { expect(run()).toBe(base.exportId); expect(actual).toBe(text); expect(calls).toBe(1); }
    else { expect(run).toThrow('LIMIT_EXCEEDED'); expect(calls).toBe(0); }
  }
});

it.each(['same-part', 'duplicate-relation', 'duplicate-sheet-id', 'unresolved', 'missing-id', 'missing-relation', 'missing-part', 'duplicate-sheet-attribute', 'duplicate-id', 'duplicate-target', 'duplicate-type', 'missing-target', 'missing-type', 'missing-relation-id', 'alias-id', 'bare-target', 'entity-id', 'entity-target', 'entity-type'])('논리/물리 시트 관계 %s를 파서 호출 전에 거부한다', kind => {
  const entries = unpack(historyWorkbookCodec.encode(correctionFixture()));
  const rels = entries.find(([name]) => name === 'xl/_rels/workbook.xml.rels')!;
  const workbook = entries.find(([name]) => name === 'xl/workbook.xml')!;
  const first = rels[1].toString().match(/<Relationship\b[^>]*Target="worksheets\/sheet1.xml"[^>]*\/>/)![0];
  const firstId = first.match(/Id="([^"]+)"/)![1];
  if (kind === 'duplicate-relation') rels[1] = Buffer.from(rels[1].toString().replace('</Relationships>', first + '</Relationships>'));
  if (kind === 'duplicate-sheet-id') workbook[1] = Buffer.from(workbook[1].toString().replace(/(<sheet\b[^>]*name="확정이력"[^>]*r:id=")[^"]+/, `$1${firstId}`));
  if (kind === 'unresolved') workbook[1] = Buffer.from(workbook[1].toString().replace(`r:id="${firstId}"`, 'r:id="missing"'));
  if (kind === 'missing-id') workbook[1] = Buffer.from(workbook[1].toString().replace(`r:id="${firstId}"`, ''));
  if (kind === 'missing-relation') rels[1] = Buffer.from(rels[1].toString().replace(first, ''));
  if (kind === 'missing-part') rels[1] = Buffer.from(rels[1].toString().replace('worksheets/sheet1.xml', 'worksheets/missing.xml'));
  if (kind === 'duplicate-sheet-attribute') workbook[1] = Buffer.from(workbook[1].toString().replace(`r:id="${firstId}"`, `r:id="${firstId}" r:id="rId2"`));
  const mutateFirst = (change: (tag: string) => string) => { rels[1] = Buffer.from(rels[1].toString().replace(first, change(first))); };
  if (kind === 'duplicate-id') mutateFirst(tag => tag.replace('/>', ` Id="${firstId}"/>`));
  if (kind === 'duplicate-target') mutateFirst(tag => tag.replace('/>', ' Target="worksheets/sheet2.xml"/>'));
  if (kind === 'duplicate-type') mutateFirst(tag => tag.replace('/>', ' Type="wrong"/>'));
  if (kind === 'missing-target') mutateFirst(tag => tag.replace(/ Target="[^"]*"/, ''));
  if (kind === 'missing-type') mutateFirst(tag => tag.replace(/ Type="[^"]*"/, ''));
  if (kind === 'missing-relation-id') mutateFirst(tag => tag.replace(/ Id="[^"]*"/, ''));
  if (kind === 'alias-id') workbook[1] = Buffer.from(workbook[1].toString().replace(`r:id="${firstId}"`, `r:id="${firstId}" id="rId2"`));
  if (kind === 'bare-target') mutateFirst(tag => tag.replace('/>', ' Target=worksheets/sheet2.xml/>'));
  if (kind === 'entity-id') {
    mutateFirst(tag => tag.replace(`Id="${firstId}"`, `Id="&#114;${firstId.slice(1)}"`));
    workbook[1] = Buffer.from(workbook[1].toString().replace(`r:id="${firstId}"`, `r:id="&#114;${firstId.slice(1)}"`));
  }
  if (kind === 'entity-target') mutateFirst(tag => tag.replace('worksheets/', '&#119;orksheets/'));
  if (kind === 'entity-type') mutateFirst(tag => tag.replace('/worksheet"', '/&#119;orksheet"'));
  if (kind === 'same-part') {
    rels[1] = Buffer.from(rels[1].toString().replace(/worksheets\/sheet[2-5]\.xml/g, 'worksheets/sheet1.xml'));
    const shared = entries.find(([name]) => name === 'xl/worksheets/sheet1.xml')!;
    shared[1] = Buffer.from(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${Array.from({length:3001}, (_, i) => `<row r="${i+1}"><c r="A${i+1}" t="str"><v>x</v></c></row>`).join('')}</sheetData></worksheet>`);
    for (const entry of entries.filter(([name]) => /xl\/worksheets\/sheet[2-5]\.xml/.test(name))) entry[1] = Buffer.from('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>');
  }
  let calls = 0;
  const codec = createHistoryWorkbookCodec((...args) => { calls++; return XLSX.read(...args); });
  if (kind === 'same-part') {
    const unguarded = XLSX.read(zip(entries,true), {type:'array'});
    const logicalRows = unguarded.SheetNames.reduce((sum, name) => sum + XLSX.utils.decode_range(unguarded.Sheets[name]['!ref']!).e.r, 0);
    expect(logicalRows).toBe(15014);
  }
  expect(() => codec.readExportId(zip(entries, true))).toThrow('INVALID_WORKBOOK');
  expect(calls).toBe(0);
});

it('시트·관계 순서와 part 이름을 바꾼 정상 일대일 관계는 허용한다', () => {
  const entries = unpack(historyWorkbookCodec.encode(correctionFixture()));
  for (const entry of entries) {
    entry[0] = entry[0].replace(/sheet([1-6])\.xml/g, 'part-$1.xml');
    if (entry[0].endsWith('.xml') || entry[0].endsWith('.rels')) entry[1] = Buffer.from(entry[1].toString().replace(/sheet([1-6])\.xml/g, 'part-$1.xml'));
  }
  const rels = entries.find(([name]) => name === 'xl/_rels/workbook.xml.rels')!;
  const relationships = [...rels[1].toString().matchAll(/<Relationship\b[^>]*\/>/g)].map(match => match[0]).reverse();
  rels[1] = Buffer.from(rels[1].toString().replace(/<Relationship\b[^>]*\/>/g, '').replace('</Relationships>', relationships.join('') + '</Relationships>').replace(/Target="worksheets\//g, 'Target="/xl/worksheets/'));
  const workbook = entries.find(([name]) => name === 'xl/workbook.xml')!;
  const sheets = [...workbook[1].toString().matchAll(/<sheet\b[^>]*\/>/g)].map(match => match[0]).reverse();
  workbook[1] = Buffer.from(workbook[1].toString().replace(/<sheet\b[^>]*\/>/g, '').replace('</sheets>', sheets.join('') + '</sheets>'));
  let calls = 0;
  const codec = createHistoryWorkbookCodec((...args) => { calls++; return XLSX.read(...args); });
  expect(codec.readExportId(zip(entries, true))).toBe(base.exportId);
  expect(calls).toBe(1);
});


it('str 셀은 SheetJS의 entity 복원 후 UTF-8 디코딩 길이와 동일하게 제한한다', () => {
  for (const length of [2000, 2001]) {
    const entries = unpack(historyWorkbookCodec.encode(correctionFixture()));
    const sheet = entries.find(([name]) => name === 'xl/worksheets/sheet4.xml')!;
    sheet[1] = Buffer.from(sheet[1].toString().replace(/<c r="H2"[\s\S]*?<\/c>/, `<c r="H2" t="str"><v>${'_x00C3__x00A9_'.repeat(length)}</v></c>`));
    let calls = 0, actual: unknown;
    const codec = createHistoryWorkbookCodec((...args) => { calls++; const book = XLSX.read(...args); actual = book.Sheets['자금자료_정정'].H2.v; return book; });
    if (length === 2000) { expect(codec.readExportId(zip(entries,true))).toBe(base.exportId); expect(actual).toBe('é'.repeat(length)); expect(calls).toBe(1); }
    else { expect(() => codec.readExportId(zip(entries,true))).toThrow('LIMIT_EXCEEDED'); expect(calls).toBe(0); }
  }
});

it.each(['t="inlineStr" t="str"', 't="inlineStr" T="str"', 't="unknown"'])('문자열 길이 검사를 우회하는 셀 타입 %s는 파서 전에 거부한다', attributes => {
  const entries = unpack(historyWorkbookCodec.encode(correctionFixture()));
  const sheet = entries.find(([name]) => name === 'xl/worksheets/sheet4.xml')!;
  sheet[1] = Buffer.from(sheet[1].toString().replace(/<c r="H2"[\s\S]*?<\/c>/, `<c r="H2" ${attributes}><v>${'x'.repeat(2001)}</v></c>`));
  let calls = 0;
  const codec = createHistoryWorkbookCodec((...args) => { calls++; return XLSX.read(...args); });
  expect(() => codec.readExportId(zip(entries,true))).toThrow('INVALID_WORKBOOK');
  expect(calls).toBe(0);
});

it('공통 십진 검증 후에도 typed numeric 셀의 지수 표현과 원래 정밀도를 유지한다', () => {
  for (const value of [1e21, 1e-7, 1.0000000000000002, -0.5]) {
    const { bytes, manifest } = editWorkbook(book => Object.assign(book.Sheets['자금자료_정정'], {
      G2: { t: 's', v: '값수정' }, H2: { t: 'n', v: value }, I2: { t: 's', v: '정밀도 확인' },
    }));
    expect(decodeCorrection(bytes, manifest)).toEqual({ patch: [{ rowId: 'row-A', action: 'set', value, reason: '정밀도 확인', evidenceNote: '' }], errors: [] });
  }
});

it('OOXML numeric exponent는 허용하지만 같은 문자열 셀은 INVALID_NUMBER다', () => {
  const { bytes, manifest } = editWorkbook(book => Object.assign(book.Sheets['자금자료_정정'], {
    G2: { t: 's', v: '값수정' }, H2: { t: 'n', v: 1000 }, I2: { t: 's', v: '숫자 셀 확인' },
  }));
  const entries = unpack(bytes);
  const sheet = entries.find(([name]) => name === 'xl/worksheets/sheet4.xml')!;
  sheet[1] = Buffer.from(sheet[1].toString().replace(/<c r="H2"[\s\S]*?<\/c>/, '<c r="H2"><v>1e3</v></c>'));
  expect(decodeCorrection(zip(entries), manifest)).toMatchObject({ errors: [], patch: [{ value: 1000 }] });
  const stringInput = editWorkbook(book => Object.assign(book.Sheets['자금자료_정정'], {
    G2: { t: 's', v: '값수정' }, H2: { t: 's', v: '1e3' }, I2: { t: 's', v: '문자열 셀 확인' },
  }));
  expect(decodeCorrection(stringInput.bytes, stringInput.manifest)).toMatchObject({ patch: [], errors: [{ code: 'INVALID_NUMBER' }] });
});
