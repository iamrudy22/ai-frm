import { readFileSync } from 'node:fs';
import { deflateSync, unzipSync, zlibSync } from 'fflate';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { projectReport, type ReportDocument, type ReportHwpxAssets } from './report-hwpx-document';
import { buildReportParts } from './report-hwpx-xml';
import { crc32 } from 'node:zlib';
const parseHwpxXml = (bytes: Uint8Array, name: string) => { const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml') as unknown as XMLDocument; expect(doc.documentElement, name).toBeTruthy(); return doc; };
import type { FinancialReport } from './report-model';
beforeAll(() => { vi.stubGlobal('DOMParser', DOMParser); vi.stubGlobal('XMLSerializer', XMLSerializer); });
const fixture = JSON.parse(readFileSync('scripts/hwpx-sample/fixtures/report-contract.json', 'utf8'));
const doc = () => projectReport(fixture.report as FinancialReport);
const roles = ['recovery', 'liquidity', 'construction', 'funding', 'cash', 'referenceRisk', 'referenceLcr'] as const;
const enc = new TextEncoder();
const concat = (...a: Uint8Array[]) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) {
    out.set(x, i);
    i += x.length;
} return out; };
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
function chunk(kind: string, bytes: Uint8Array) { const data = concat(enc.encode(kind), bytes); return concat(u32(bytes.length), data, u32(crc32(data))); }
function png(w = 40, h = 10, raw?: Uint8Array, compressed?: Uint8Array, before: Uint8Array[] = [], after: Uint8Array[] = []) {
    return concat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', concat(u32(w), u32(h), new Uint8Array([8, 6, 0, 0, 0]))), ...before, chunk('IDAT', compressed ?? zlibSync(raw ?? new Uint8Array(h * (w * 4 + 1)))), ...after, chunk('IEND', new Uint8Array()));
}
function assets(): ReportHwpxAssets { return Object.fromEntries(roles.map((r, i) => [r, png(i < 5 ? 400 : 600, i < 5 ? 100 : 300)])) as ReportHwpxAssets; }
const template = () => unzipSync(readFileSync('scripts/hwpx-sample/blank.hwpx'));
const all = (root: XMLDocument | Element, local: string) => Array.from(root.getElementsByTagNameNS('*', local));
const first = (root: XMLDocument | Element, local: string) => all(root, local)[0];
function text(root: Element): string { return Array.from(root.childNodes).map(n => n.nodeType === 3 ? n.nodeValue : n.nodeType === 1 && (n as Element).localName === 'lineBreak' ? '\n' : n.nodeType === 1 ? text(n as Element) : '').join(''); }
describe('buildReportParts', () => {
    it('writes editable flow, exact display strings, seven preserved image bytes, references and native footer', () => {
        const base = template(), images = assets(), before = structuredClone(base), original = structuredClone(images);
        const result = buildReportParts(doc(), base, images);
        const section = parseHwpxXml(result['Contents/section0.xml'], 'section'), header = parseHwpxXml(result['Contents/header.xml'], 'header');
        const strings = all(section, 't').map(text);
        expect(strings).toEqual([
  '합성 <재무> & 위험 보고서', '(2026.10.29, 자금기획팀)', '□ 재무위험지수 종합',
  '◇ 적정 시재 ', '(적정시재 부족)', '  ◇ 건설경기 인식 지수 ', '(정상)',
  '  ◇ 대금 회수 위험 ', '(주의)', '  ◇ 조달위험 인식 지수 ', '(산출 중)',
  '  ◇ 유동성 Gap ', '(정상 순유입)', '□ 위험수준 측정결과',
  '○ 대금 회수 위험 1.00 ', '[주의]', '- 회수율 1.00의 기존 판정을 유지합니다.', '* 분양회수 실적 ÷ 분양회수 계획',
  '○ 유동성 Gap — ', '[정상 순유입]', '- 정상 순유입으로 비율을 적용하지 않습니다.', '* 기초시재 ÷ (향후 3개월 지출 − 수입)',
  '○ 건설경기 인식 지수 0 ', '[정상]', '- 지수 0도 유효한 표시값입니다.', '기준: 2026/07 합성 기준', '* Σ(세부지표 점수 × 가중치)',
  '○ 조달위험 인식 지수 — ', '[산출 중]', '- 조달위험 자료를 조회하고 있습니다.', '* 공사채 AAA 1년 금리 − 국고채 1년 금리',
  '□ 적정시재 산정결과', '○ 적정 시재 -17 억원 ', '[적정시재 부족]', '- 현재시재 -17 억원입니다.', '* 20% × 분양회수 + 10% × 기타수입',
  '참고', '□ 위험단계 기준', '□ 적정시재 산정방식 (LCR 방식)',
]);
        expect(strings.join('\n')).not.toContain('숨긴');
        expect(strings).toContain('○ 건설경기 인식 지수 0 ');
        expect(strings).toContain('○ 적정 시재 -17 억원 ');
        expect(all(section, 'pic').map(p => first(p, 'img').getAttribute('binaryItemIDRef'))).toEqual(roles.map(r => 'image_' + r));
        for (const r of roles) {
            expect(result['BinData/' + r + '.png']).toEqual(images[r]);
            expect(result['BinData/' + r + '.png']).not.toBe(images[r]);
        }
        expect(all(section, 'p').filter(p => p.parentNode === section.documentElement && p.getAttribute('pageBreak') === '1')).toHaveLength(2);
        expect(all(section, 'footer')).toHaveLength(1);
        expect(first(section, 'autoNum').getAttribute('numType')).toBe('PAGE');
        expect(first(section, 'pageNum').getAttribute('pos')).toBe('BOTTOM_CENTER');
        expect(all(section, 'linesegarray')).toHaveLength(0);
        const page = first(section, 'pagePr');
        expect([page.getAttribute('width'), page.getAttribute('height')]).toEqual(['59528', '84189']);
        expect(first(page, 'margin').getAttribute('left')).toBe('3402');
        expect(all(section, 'pic').map(p => [first(p, 'sz').getAttribute('width'), first(p, 'sz').getAttribute('height')])).toEqual(roles.map((_, i) => ['52724', i < 5 ? '13181' : '26362']));
        const summary = first(section, 'tbl');
        expect(summary.getAttribute('rowCnt')).toBe('1');
        expect(summary.getAttribute('colCnt')).toBe('1');
        const chars = all(header, 'charPr');
        expect(all(summary, 'run').map(r => chars.find(c => c.getAttribute('id') === r.getAttribute('charPrIDRef'))!.getAttribute('textColor'))).toEqual(['#171717', '#FF3B16', '#171717', '#0088BF', '#171717', '#FF3B16', '#171717', '#171717', '#171717', '#171717']);
        expect(base).toEqual(before);
        expect(images).toEqual(original);
        expect(result['version.xml']).not.toBe(base['version.xml']);
        expect(result['Preview/PrvImage.png']).toBeUndefined();
        expect(buildReportParts(doc(), base, images)).toEqual(result);
    });
    it('retains validated typography, title padding/ignoreMargin, line spacing and yellow summary fill', () => {
        const result = buildReportParts(doc(), template(), assets());
        const header = parseHwpxXml(result['Contents/header.xml'], 'header'), section = parseHwpxXml(result['Contents/section0.xml'], 'section');
        const paragraphs = all(section, 'p').filter(p => p.parentNode === section.documentElement);
        const prop = (p: Element) => all(header, 'paraPr').find(c => c.getAttribute('id') === p.getAttribute('paraPrIDRef'))!;
        const char = (p: Element) => all(header, 'charPr').find(c => c.getAttribute('id') === first(p, 'run').getAttribute('charPrIDRef'))!;
        expect(char(paragraphs[0]).getAttribute('height')).toBe('1800');
        expect(char(paragraphs[1]).getAttribute('height')).toBe('1200');
        expect(first(prop(paragraphs[0]), 'border').getAttribute('ignoreMargin')).toBe('1');
        expect(first(prop(paragraphs[0]), 'border').getAttribute('offsetBottom')).toBe('900');
        expect(all(prop(paragraphs[0]), 'next').map(e => e.getAttribute('value'))).toEqual(['1500', '3000']);
        expect(all(prop(paragraphs[1]), 'lineSpacing').map(e => e.getAttribute('value'))).toEqual(['150', '150']);
        expect(all(header, 'font').every(f => f.getAttribute('face') === 'Dotum')).toBe(true);
        expect(all(header, 'winBrush').some(f => f.getAttribute('faceColor') === '#FFFDD4')).toBe(true);
    });
    it('represents newlines and XML metacharacters as text and preserves empty basis', () => {
        const report = structuredClone(fixture.report) as FinancialReport;
        report.metrics = report.metrics.map(m => m.id === 'construction' ? { ...m, basis: '', narrative: '한글 <&>\n다음 줄' } : m);
        const result = buildReportParts(projectReport(report), template(), assets());
        const section = parseHwpxXml(result['Contents/section0.xml'], 'section');
        expect(all(section, 't').map(text)).toContain('- 한글 <&>\n다음 줄');
        expect(all(section, 't').map(text)).toContain('기준: ');
    });
    it('rejects absent/duplicate assets, invalid profiles/tones/styles and template collisions', () => {
        const imageDoc = (role = 'recovery'): ReportDocument => ({ reportMonth: '', generatedOn: '', styleProfile: 'report', pages: [{ blocks: [{ kind: 'image', role: role as 'recovery' }] }] });
        expect(() => buildReportParts(doc(), template(), {} as ReportHwpxAssets)).toThrow(/PNG/);
        expect(() => buildReportParts({ ...imageDoc(), pages: [{ blocks: [{ kind: 'image', role: 'recovery' }, { kind: 'image', role: 'recovery' }] }] }, template(), assets())).toThrow(/duplicate/);
        expect(() => buildReportParts({ ...doc(), styleProfile: 'bogus' } as unknown as ReportDocument, template(), assets())).toThrow(/profile/);
        expect(() => buildReportParts({ ...doc(), pages: [] }, template(), assets())).toThrow(/pages/);
        const badTone = { ...doc(), pages: [{ blocks: [{ kind: 'summary', items: [{ label: 'x', status: 'x', tone: 'bogus' }] }] }] } as unknown as ReportDocument;
        expect(() => buildReportParts(badTone, template(), assets())).toThrow(/tone/);
        const badStyle = { ...doc(), pages: [{ blocks: [{ kind: 'text', text: 'x', style: 'bogus' }] }] } as unknown as ReportDocument;
        expect(() => buildReportParts(badStyle, template(), assets())).toThrow(/style/);
        expect(() => buildReportParts(imageDoc(), { ...template(), 'BinData/recovery.png': png() }, assets())).toThrow(/collid/);
    });
    it('rejects incomplete dynamic Huffman alphabets that strict zlib readers reject', () => {
        // Independent fixture: five zero bytes encoded with an incomplete code-length alphabet.
        // Python zlib reports "invalid code lengths set"; accepting it creates a corrupt HWPX image.
        const compressed = new Uint8Array(Buffer.from('789c05c00108000000002001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000050100050001', 'hex'));
        const imageDoc: ReportDocument = { reportMonth: '', generatedOn: '', styleProfile: 'report', pages: [{ blocks: [{ kind: 'image', role: 'recovery' }] }] };
        expect(() => buildReportParts(imageDoc, template(), { ...assets(), recovery: png(1, 1, undefined, compressed) })).toThrow(/PNG/);
    });
    it('rejects corrupt PNG containers, pixel streams, unsupported layouts, decode bombs and trailing deflate', () => {
        const imageDoc: ReportDocument = { reportMonth: '', generatedOn: '', styleProfile: 'report', pages: [{ blocks: [{ kind: 'image', role: 'recovery' }] }] };
        const valid = png(1, 1), raw = new Uint8Array([0, 0, 0, 0, 255]), compressed = zlibSync(raw);
        const cases = [new Uint8Array(), valid.slice(0, 24), valid.slice(0, -12), concat(valid, new Uint8Array([0])), png(0, 1), png(1, 1, raw, enc.encode('bad')),
            png(1, 1, raw, compressed.slice(0, -1)), png(1, 1, new Uint8Array(4)), png(1, 1, new Uint8Array(6)), png(1, 1, new Uint8Array([5, 0, 0, 0, 0])),
            png(1, 1, raw, concat(compressed, enc.encode('junk'))), png(1, 1, raw, concat(compressed, zlibSync(raw))), png(100000, 100000, raw),
            png(1, 1, raw, undefined, [chunk('ABCD', new Uint8Array())]), png(1, 1, raw, undefined, [chunk('PLTE', new Uint8Array(4))]),
            png(1, 1, raw, compressed.slice(0, 4), [], [chunk('tEXt', enc.encode('x')), chunk('IDAT', compressed.slice(4))])];
        for (const p of cases)
            expect(() => buildReportParts(imageDoc, template(), { ...assets(), recovery: p })).toThrow(/PNG/);
        const crcBad = valid.slice();
        crcBad[29] ^= 1;
        expect(() => buildReportParts(imageDoc, template(), { ...assets(), recovery: crcBad })).toThrow(/PNG/);
        // Correct CRCs isolate unsupported pixel metadata from container errors.
        for (const [depth, color, interlace] of [[16, 6, 0], [8, 6, 1], [8, 3, 0]]) {
            const p = concat(valid.slice(0, 8), chunk('IHDR', concat(u32(1), u32(1), new Uint8Array([depth, color, 0, 0, interlace]))), chunk('IDAT', compressed), chunk('IEND', new Uint8Array()));
            expect(() => buildReportParts(imageDoc, template(), { ...assets(), recovery: p })).toThrow(/PNG/);
        }
        // A raw DEFLATE stream must never masquerade as the required zlib stream.
        expect(() => buildReportParts(imageDoc, template(), { ...assets(), recovery: png(1, 1, raw, deflateSync(raw)) })).toThrow(/PNG/);
    });
});
