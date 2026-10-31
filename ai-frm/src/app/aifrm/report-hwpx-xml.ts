/** Native HWPX report flow; uses browser XML DOM and preserves encoded PNG bytes. */
import { unzlibSync } from 'fflate';
import type { ImageBlock, ReportDocument, ReportHwpxAssets, ReportImageRole, ReportTextStyle, ReportTone, SummaryBlock } from './report-hwpx-document';
import { crc32, parseHwpxXml, type HwpxParts } from './report-hwpx-package';
const NS = { hp: 'http://www.hancom.co.kr/hwpml/2011/paragraph', hs: 'http://www.hancom.co.kr/hwpml/2011/section', hc: 'http://www.hancom.co.kr/hwpml/2011/core', hh: 'http://www.hancom.co.kr/hwpml/2011/head', opf: 'http://www.idpf.org/2007/opf/' };
const STYLES: Record<ReportTextStyle, readonly [
    number,
    boolean,
    string,
    number,
    number
]> = {
    title: [18, true, 'CENTER', 0, 15], date: [12, false, 'RIGHT', 0, 6], body: [13, false, 'LEFT', 0, 3], formula: [9, false, 'LEFT', 0, 3],
    summary: [14, true, 'LEFT', 0, 0], heading: [13.5, true, 'LEFT', 6, 3], 'reference-header': [13, false, 'LEFT', 0, 6],
    'metric-body': [13, false, 'LEFT', 0, 3], 'metric-note': [9, false, 'LEFT', 0, 3], footer: [9, false, 'CENTER', 0, 0],
};
const TONES: Record<ReportTone, string> = { ink: '#171717', blue: '#0088BF', crisis: '#FF3B16' };
const INLINE = { treatAsChar: 1, affectLSpacing: 0, flowWithText: 1, allowOverlap: 0, holdAnchorAndSO: 0, vertRelTo: 'PARA', horzRelTo: 'COLUMN', vertAlign: 'TOP', horzAlign: 'LEFT', vertOffset: 0, horzOffset: 0 };
const ZERO = { left: 0, right: 0, top: 0, bottom: 0 };
const encoder = new TextEncoder();
type Attrs = Record<string, string | number>;
function attrs(e: Element, values: Attrs, replace = false) {
    if (replace)
        for (const a of Array.from(e.attributes))
            e.removeAttributeNode(a);
    for (const [k, v] of Object.entries(values))
        e.setAttribute(k, String(v));
}
function add(parent: Node, name: string, values: Attrs = {}): Element {
    const [prefix] = name.split(':');
    const doc = parent.nodeType === 9 ? parent as XMLDocument : parent.ownerDocument!;
    const e = doc.createElementNS(NS[prefix as keyof typeof NS], name);
    attrs(e, values);
    parent.appendChild(e);
    return e;
}
function children(e: Element): Element[] { return Array.from(e.childNodes).filter(n => n.nodeType === 1) as Element[]; }
function find(e: Document | Element, name: string): Element[] { const [p, l] = name.split(':'); return Array.from(e.getElementsByTagNameNS(NS[p as keyof typeof NS], l)); }
function one(e: Document | Element, name: string): Element { const found = find(e, name)[0]; if (!found)
    throw new Error('template lacks ' + name); return found; }
function clone(e: Element): Element { return e.cloneNode(true) as Element; }
function nextId(e: Element): string { return String(Math.max(...children(e).map(x => Number(x.getAttribute('id')))) + 1); }
function appendText(run: Element, text: string) {
    if (typeof text !== 'string')
        throw new Error('native text must be a string');
    const t = add(run, 'hp:t');
    text.split('\n').forEach((part, i) => { if (i)
        add(t, 'hp:lineBreak'); t.appendChild(t.ownerDocument!.createTextNode(part)); });
}
function xml(doc: XMLDocument): Uint8Array { return encoder.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + new XMLSerializer().serializeToString(doc.documentElement)); }
function paragraphBorder(header: XMLDocument, sides: readonly string[], color: string, weight: string): string {
    const fills = one(header, 'hh:borderFills'), entry = clone(children(fills)[0]), id = nextId(fills);
    entry.setAttribute('id', id);
    for (const side of ['left', 'right', 'top', 'bottom'])
        attrs(one(entry, 'hh:' + side + 'Border'), { type: sides.includes(side) ? 'SOLID' : 'NONE', width: weight, color }, true);
    fills.appendChild(entry);
    fills.setAttribute('itemCnt', String(children(fills).length));
    return id;
}
function formats(header: XMLDocument): Record<string, readonly [
    string,
    string
]> {
    const chars = one(header, 'hh:charProperties'), paras = one(header, 'hh:paraProperties');
    if (children(chars).length < 2 || !children(paras).length)
        throw new Error('template lacks required base text formats');
    for (const font of find(header, 'hh:font'))
        font.setAttribute('face', 'Dotum');
    const charBase = children(chars)[1], paraBase = children(paras)[0], result: Record<string, readonly [
        string,
        string
    ]> = {};
    for (const [style, [size, bold, align, before, after]] of Object.entries(STYLES)) {
        const char = clone(charBase), para = clone(paraBase), charId = nextId(chars), paraId = nextId(paras);
        attrs(char, { id: charId, height: Math.round(size * 100), textColor: TONES[style === 'reference-header' ? 'blue' : 'ink'] });
        attrs(one(char, 'hh:fontRef'), { hangul: 0, latin: 0, hanja: 0, japanese: 0, other: 0, symbol: 0, user: 0 }, true);
        for (const b of find(char, 'hh:bold'))
            b.parentNode!.removeChild(b);
        if (bold) {
            const b = header.createElementNS(NS.hh, 'hh:bold');
            const beforeNames = ['fontRef', 'ratio', 'spacing', 'relSz', 'offset', 'italic'];
            char.insertBefore(b, children(char).find(c => !beforeNames.includes(c.localName)) ?? null);
        }
        attrs(para, { id: paraId, snapToGrid: 0 });
        one(para, 'hh:align').setAttribute('horizontal', align);
        attrs(one(para, 'hh:breakSetting'), { keepWithNext: ['title', 'heading', 'metric-body', 'metric-note'].includes(style) ? 1 : 0, keepLines: 1, pageBreakBefore: 0 });
        for (const margin of find(para, 'hh:margin')) {
            const scale = margin.parentNode?.nodeType === 1 && (margin.parentNode as Element).localName === 'default' ? 2 : 1;
            for (const child of children(margin))
                attrs(child, { value: Math.round((child.localName === 'prev' ? before : child.localName === 'next' ? after : 0) * 100) * scale, unit: 'HWPUNIT' });
        }
        for (const line of find(para, 'hh:lineSpacing'))
            attrs(line, { type: 'PERCENT', value: 150, unit: 'HWPUNIT' }, true);
        chars.appendChild(char);
        paras.appendChild(para);
        result[style] = [charId, paraId];
    }
    for (const style of ['summary', 'metric-body'])
        for (const tone of ['blue', 'crisis'] as const) {
            const source = children(chars).find(c => c.getAttribute('id') === result[style][0])!, char = clone(source), id = nextId(chars);
            attrs(char, { id, textColor: TONES[tone] });
            chars.appendChild(char);
            result[style + ':' + tone] = [id, result[style][1]];
        }
    for (const [style, sides, color, weight] of [['title', ['top', 'bottom'], '#0088BF', '1.0 mm'], ['reference-header', ['bottom'], '#528FC6', '0.12 mm']] as const) {
        const id = paragraphBorder(header, sides, color, weight), para = children(paras).find(p => p.getAttribute('id') === result[style][1])!, border = one(para, 'hh:border');
        border.setAttribute('borderFillIDRef', id);
        if (style === 'title')
            attrs(border, { offsetTop: 900, offsetBottom: 900, ignoreMargin: 1 });
    }
    chars.setAttribute('itemCnt', String(children(chars).length));
    paras.setAttribute('itemCnt', String(children(paras).length));
    return result;
}
function summaryFill(header: XMLDocument): string {
    const id = paragraphBorder(header, ['left', 'right', 'top', 'bottom'], '#B9B9B9', '0.2 mm'), fills = one(header, 'hh:borderFills'), entry = children(fills).find(e => e.getAttribute('id') === id)!;
    for (const brush of find(entry, 'hc:fillBrush'))
        brush.parentNode!.removeChild(brush);
    add(add(entry, 'hc:fillBrush'), 'hc:winBrush', { faceColor: '#FFFDD4', hatchColor: '#999999', alpha: 0 });
    return id;
}
/** Verify exact DEFLATE end and decoded size before invoking the bounded inflater. */
function deflateSize(data: Uint8Array, expected: number): void {
    let bit = 0, produced = 0;
    const read = (n: number) => { if (bit + n > data.length * 8)
        throw new Error('PNG incomplete deflate'); let v = 0; for (let i = 0; i < n; i++)
        v |= ((data[bit >> 3] >> (bit++ & 7)) & 1) << i; return v; };
    const table = (lengths: number[], requireComplete = false) => {
        const count = new Array<number>(16).fill(0), next = new Array<number>(16).fill(0), map = new Map<number, number>();
        for (const n of lengths) {
            if (n < 0 || n > 15)
                throw new Error('PNG invalid Huffman length');
            count[n]++;
        }
        let code = 0, remaining = 1;
        for (let n = 1; n <= 15; n++) {
            remaining = remaining * 2 - count[n];
            if (remaining < 0)
                throw new Error('PNG oversubscribed Huffman tree');
            code = (code + (count[n - 1] ?? 0)) * 2;
            if (n === 1)
                code = 0;
            next[n] = code;
        }
        if (remaining > 0 && (requireComplete || Math.max(...lengths) > 1))
            throw new Error('PNG incomplete Huffman tree');
        lengths.forEach((n, s) => { if (n) {
            let c = next[n]++, rev = 0;
            for (let j = 0; j < n; j++) {
                rev = (rev << 1) | (c & 1);
                c >>= 1;
            }
            map.set((1 << n) | rev, s);
        } });
        return () => { let v = 0; for (let n = 1; n <= 15; n++) {
            v |= read(1) << (n - 1);
            const s = map.get((1 << n) | v);
            if (s !== undefined)
                return s;
        } throw new Error('PNG invalid Huffman code'); };
    };
    const lengthBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    const lengthExtra = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    const distanceBase = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    const distanceExtra = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
    let final = 0;
    do {
        final = read(1);
        const type = read(2);
        if (type === 0) {
            bit = (bit + 7) & ~7;
            const len = read(16);
            if ((len ^ read(16)) !== 65535)
                throw new Error('PNG invalid stored block');
            bit += len * 8;
            if (bit > data.length * 8)
                throw new Error('PNG incomplete stored block');
            produced += len;
        }
        else {
            if (type === 3)
                throw new Error('PNG invalid deflate block');
            let lit: number[], dist: number[];
            if (type === 1) {
                lit = Array.from({ length: 288 }, (_, i) => i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8);
                dist = new Array(32).fill(5);
            }
            else {
                const nl = read(5) + 257, nd = read(5) + 1, nc = read(4) + 4;
                // RFC1951 code-length alphabet order.
                const actualOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
                const codeLengths = new Array<number>(19).fill(0);
                for (let i = 0; i < nc; i++)
                    codeLengths[actualOrder[i]] = read(3);
                const decode = table(codeLengths, true), lengths: number[] = [];
                while (lengths.length < nl + nd) {
                    const symbol = decode();
                    if (symbol < 16)
                        lengths.push(symbol);
                    else {
                        if (symbol === 16 && !lengths.length)
                            throw new Error('PNG invalid repeat');
                        const n = symbol === 16 ? read(2) + 3 : symbol === 17 ? read(3) + 3 : read(7) + 11;
                        const value = symbol === 16 ? lengths[lengths.length - 1] : 0;
                        if (lengths.length + n > nl + nd)
                            throw new Error('PNG invalid repeat size');
                        for (let i = 0; i < n; i++)
                            lengths.push(value);
                    }
                }
                lit = lengths.slice(0, nl);
                dist = lengths.slice(nl);
                if (!lit[256])
                    throw new Error('PNG missing deflate end');
            }
            const decode = table(lit), distance = table(dist);
            let symbol;
            while ((symbol = decode()) !== 256) {
                if (symbol < 256)
                    produced++;
                else {
                    if (symbol > 285)
                        throw new Error('PNG invalid length');
                    const idx = symbol - 257, n = lengthBase[idx] + read(lengthExtra[idx]), d = distance();
                    if (d > 29)
                        throw new Error('PNG invalid distance');
                    if (distanceBase[d] + read(distanceExtra[d]) > produced)
                        throw new Error('PNG invalid backreference');
                    produced += n;
                }
                if (produced > expected)
                    throw new Error('PNG decoded size exceeds expected');
            }
        }
        if (produced > expected)
            throw new Error('PNG decoded size exceeds expected');
    } while (!final);
    if (produced !== expected || Math.ceil(bit / 8) !== data.length)
        throw new Error('PNG incomplete/trailing deflate or scanline size');
}
function pngDimensions(bytes: Uint8Array | undefined, role: string): readonly [
    number,
    number
] {
    const bad = () => new Error('malformed PNG image ' + role);
    if (!(bytes instanceof Uint8Array) || bytes.length < 8 || [137, 80, 78, 71, 13, 10, 26, 10].some((b, i) => bytes[i] !== b))
        throw bad();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), ids: Uint8Array[] = [];
    let offset = 8, w = 0, h = 0, color = 0, depth = 0, interlace = 0, palette = false, closed = false;
    while (offset + 12 <= bytes.length) {
        const length = view.getUint32(offset), end = offset + 12 + length;
        if (end > bytes.length)
            throw bad();
        const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)), data = bytes.subarray(offset + 8, end - 4);
        if (!/^[A-Za-z]{4}$/.test(kind) || (bytes[offset + 6] & 32) || crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4))
            throw bad();
        if (offset === 8) {
            if (kind !== 'IHDR' || length !== 13)
                throw bad();
            w = view.getUint32(offset + 8);
            h = view.getUint32(offset + 12);
            [depth, color, , , interlace] = data.subarray(8);
            if (!w || !h || w > 2147483647 || h > 2147483647 || data[10] || data[11] || ![0, 2, 3, 4, 6].includes(color))
                throw bad();
        }
        else if (kind === 'IHDR')
            throw bad();
        else if (kind === 'PLTE') {
            if (palette || ids.length || [0, 4].includes(color) || !length || length > 768 || length % 3)
                throw new Error('malformed PNG PLTE ' + role);
            palette = true;
        }
        else if (kind === 'IDAT') {
            if (closed)
                throw new Error('malformed PNG noncontiguous IDAT ' + role);
            if (depth !== 8 || color === 3 || interlace !== 0)
                throw new Error('unsupported PNG pixel format ' + role);
            ids.push(data);
        }
        else if (kind === 'IEND') {
            if (length || end !== bytes.length || !ids.length)
                throw bad();
            const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[color], row = w * channels + 1, expected = row * h;
            if (expected > 64 * 1024 * 1024)
                throw new Error('PNG decoded image exceeds 64 MiB limit ' + role);
            const compressed = new Uint8Array(ids.reduce((sum, b) => sum + b.length, 0));
            let pos = 0;
            for (const b of ids) {
                compressed.set(b, pos);
                pos += b.length;
            }
            if (compressed.length < 6 || (compressed[0] & 15) !== 8 || (compressed[0] >> 4) > 7 || (compressed[0] * 256 + compressed[1]) % 31 || (compressed[1] & 32))
                throw bad();
            deflateSize(compressed.subarray(2, -4), expected);
            let pixels: Uint8Array;
            try {
                pixels = unzlibSync(compressed, { out: new Uint8Array(expected + 1) });
            }
            catch {
                throw bad();
            }
            if (pixels.length !== expected)
                throw bad();
            let a = 1, b = 0;
            for (const x of pixels) {
                a = (a + x) % 65521;
                b = (b + a) % 65521;
            }
            const checksum = new DataView(compressed.buffer).getUint32(compressed.length - 4);
            if ((((b << 16) | a) >>> 0) !== checksum)
                throw bad();
            for (let p = 0; p < expected; p += row)
                if (pixels[p] > 4)
                    throw new Error('malformed PNG scanline filter ' + role);
            return [w, h];
        }
        else if (!(bytes[offset + 4] & 32))
            throw new Error('unsupported PNG critical chunk ' + kind + ' ' + role);
        if (ids.length && kind !== 'IDAT')
            closed = true;
        offset = end;
    }
    throw bad();
}
function picture(run: Element, role: string, width: number, height: number, id: number) {
    const p = add(run, 'hp:pic', { id, zOrder: 0, numberingType: 'PICTURE', textWrap: 'SQUARE', textFlow: 'BOTH_SIDES', lock: 0, dropcapstyle: 'None', href: '', groupLevel: 0, instid: id, reverse: 0 });
    add(p, 'hp:offset', { x: 0, y: 0 });
    add(p, 'hp:orgSz', { width, height });
    add(p, 'hp:curSz', { width, height });
    add(p, 'hp:flip', { horizontal: 0, vertical: 0 });
    add(p, 'hp:rotationInfo', { angle: 0, centerX: Math.floor(width / 2), centerY: Math.floor(height / 2), rotateimage: 1 });
    const rendering = add(p, 'hp:renderingInfo');
    for (const name of ['transMatrix', 'scaMatrix', 'rotMatrix'])
        add(rendering, 'hc:' + name, { e1: 1, e2: 0, e3: 0, e4: 0, e5: 1, e6: 0 });
    const rectangle = add(p, 'hp:imgRect');
    [[0, 0], [width, 0], [width, height], [0, height]].forEach(([x, y], i) => add(rectangle, 'hc:pt' + i, { x, y }));
    add(p, 'hp:imgClip', { left: 0, right: width, top: 0, bottom: height });
    add(p, 'hp:inMargin', ZERO);
    add(p, 'hp:imgDim', { dimwidth: width, dimheight: height });
    add(p, 'hc:img', { binaryItemIDRef: 'image_' + role, bright: 0, contrast: 0, effect: 'REAL_PIC', alpha: 0 });
    add(p, 'hp:effects');
    add(p, 'hp:sz', { width, height, widthRelTo: 'ABSOLUTE', heightRelTo: 'ABSOLUTE', protect: 0 });
    add(p, 'hp:pos', INLINE);
    add(p, 'hp:outMargin', ZERO);
    add(p, 'hp:shapeComment').textContent = role;
}
export function buildReportParts(document: ReportDocument, template: HwpxParts, assets: ReportHwpxAssets): HwpxParts {
    if (document.styleProfile !== 'report')
        throw new Error('unknown style profile');
    if (!document.pages.length || document.pages.some(p => !p.blocks.length))
        throw new Error('document requires non-empty semantic pages');
    const pixels = new Map<ReportImageRole, readonly [
        number,
        number
    ]>(), roles = new Set<string>();
    const validText = (...v: unknown[]) => { if (v.some(x => typeof x !== 'string'))
        throw new Error('native text must be a string'); };
    const validTone = (t: string) => { if (!Object.hasOwn(TONES, t))
        throw new Error('unknown text tone'); };
    const validImage = (role: ReportImageRole) => { if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(role))
        throw new Error('invalid image role'); if (roles.has(role))
        throw new Error('duplicate image role ' + role); roles.add(role); pixels.set(role, pngDimensions(assets[role], role)); };
    for (const page of document.pages)
        for (const block of page.blocks) {
            if (block.kind === 'text') {
                if (!Object.hasOwn(STYLES, block.style))
                    throw new Error('unknown text style');
                validText(block.text);
            }
            else if (block.kind === 'image')
                validImage(block.role);
            else if (block.kind === 'metric') {
                validText(block.title, block.value, block.status, block.narrative, block.formula);
                if (block.basis !== null)
                    validText(block.basis);
                validTone(block.tone);
                validImage(block.imageRole);
            }
            else if (block.kind === 'summary')
                for (const item of block.items) {
                    validText(item.label, item.status);
                    validTone(item.tone);
                }
            else
                throw new Error('unsupported semantic block');
        }
    const parts: Record<string, Uint8Array> = Object.fromEntries(Object.entries(template).map(([k, v]) => [k, v.slice()]));
    const header = parseHwpxXml(parts['Contents/header.xml'], 'Contents/header.xml'), source = parseHwpxXml(parts['Contents/section0.xml'], 'Contents/section0.xml'), manifest = parseHwpxXml(parts['Contents/content.hpf'], 'Contents/content.hpf');
    if (header.documentElement.getAttribute('secCnt') !== '1')
        throw new Error('single-section template is required');
    const sourceRun = one(source, 'hp:run'), sec = children(sourceRun).find(e => e.localName === 'secPr'), column = children(sourceRun).find(e => e.localName === 'ctrl');
    if (!sec || !column)
        throw new Error('template section/column controls required');
    const secPr = clone(sec), pagePr = one(secPr, 'hp:pagePr'), margin = one(pagePr, 'hp:margin');
    attrs(pagePr, { width: 59528, height: 84189, landscape: 'WIDELY' });
    attrs(margin, { header: 1417, footer: 1417, gutter: 0, left: 3402, right: 3402, top: 2835, bottom: 2835 }, true);
    const width = 52724, height = 78519, fmt = formats(header), border = summaryFill(header);
    const section = source.implementation.createDocument(NS.hs, 'hs:sec', null), root = section.documentElement;
    for (const a of Array.from(header.documentElement.attributes))
        if (a.name === 'xmlns' || a.prefix === 'xmlns')
            root.setAttributeNS('http://www.w3.org/2000/xmlns/', a.name, a.value);
    let paragraphId = 0, objectId = 10000;
    const preview: string[] = [];
    const run = (parent: Element, style: ReportTextStyle, tone: ReportTone = 'ink') => add(parent, 'hp:run', { charPrIDRef: fmt[style + (tone === 'ink' ? '' : ':' + tone)][0] });
    const paragraph = (parent: Element, style: ReportTextStyle, pageBreak = false): readonly [
        Element,
        Element
    ] => {
        const p = add(parent, 'hp:p', { id: paragraphId++, paraPrIDRef: fmt[style][1], styleIDRef: 0, pageBreak: pageBreak ? 1 : 0, columnBreak: 0, merged: 0 }), r = run(p, style);
        if (parent === root && children(root).length === 1) {
            r.appendChild(section.importNode(secPr, true));
            r.appendChild(section.importNode(column, true));
            const footer = add(add(r, 'hp:ctrl'), 'hp:footer', { id: 0, applyPageType: 'BOTH' }), sub = add(footer, 'hp:subList', { id: '', textDirection: 'HORIZONTAL', lineWrap: 'BREAK', vertAlign: 'BOTTOM', linkListIDRef: 0, linkListNextIDRef: 0, textWidth: width, textHeight: 1417, hasTextRef: 0, hasNumRef: 0 });
            const [fp, fr] = paragraph(sub, 'footer'), auto = add(add(fr, 'hp:ctrl'), 'hp:autoNum', { num: 1, numType: 'PAGE' });
            add(auto, 'hp:autoNumFormat', { type: 'DIGIT', userChar: '', prefixChar: '', suffixChar: '', supscript: 0 });
            add(add(run(fp, 'footer'), 'hp:ctrl'), 'hp:pageNum', { pos: 'BOTTOM_CENTER', formatType: 'DIGIT', sideChar: '' });
        }
        return [p, r];
    };
    const items = one(manifest, 'opf:manifest'), existing = new Set(children(items).map(i => i.getAttribute('id')));
    if (!children(items).some(i => i.getAttribute('href') === 'version.xml')) {
        let id = 'version', i = 1;
        while (existing.has(id))
            id = 'version_' + i++;
        add(items, 'opf:item', { id, href: 'version.xml', 'media-type': 'application/xml' });
        existing.add(id);
    }
    const image = (r: Element, block: ImageBlock) => {
        const [pw, ph] = pixels.get(block.role)!, scale = Math.min(width / pw, height / ph), w = Math.max(1, Math.round(pw * scale)), h = Math.max(1, Math.round(ph * scale)), target = 'BinData/' + block.role + '.png', id = 'image_' + block.role;
        if (Object.hasOwn(parts, target) || existing.has(id))
            throw new Error('image target/ID collides with template');
        parts[target] = assets[block.role].slice();
        add(items, 'opf:item', { id, href: target, 'media-type': 'image/png', isEmbeded: 1 });
        existing.add(id);
        picture(r, block.role, w, h, objectId++);
    };
    const summary = (r: Element, block: SummaryBlock | string) => {
        const table = add(r, 'hp:tbl', { id: objectId++, zOrder: 0, numberingType: 'TABLE', textWrap: 'TOP_AND_BOTTOM', textFlow: 'BOTH_SIDES', lock: 0, dropcapstyle: 'None', pageBreak: 'CELL', repeatHeader: 0, rowCnt: 1, colCnt: 1, cellSpacing: 0, borderFillIDRef: border, noAdjust: 0 });
        add(table, 'hp:sz', { width, height: 282, widthRelTo: 'ABSOLUTE', heightRelTo: 'ABSOLUTE', protect: 0 });
        add(table, 'hp:pos', INLINE);
        add(table, 'hp:outMargin', ZERO);
        const padding = { left: 510, right: 510, top: 141, bottom: 141 };
        add(table, 'hp:inMargin', padding);
        const cell = add(add(table, 'hp:tr'), 'hp:tc', { name: '', header: 0, hasMargin: 0, protect: 0, editable: 0, dirty: 0, borderFillIDRef: border }), sub = add(cell, 'hp:subList', { id: '', textDirection: 'HORIZONTAL', lineWrap: 'BREAK', vertAlign: 'CENTER', linkListIDRef: 0, linkListNextIDRef: 0, textWidth: 0, textHeight: 0, hasTextRef: 0, hasNumRef: 0 }), [p, firstRun] = paragraph(sub, 'summary');
        if (typeof block === 'string')
            appendText(firstRun, block);
        else
            block.items.forEach((item, i) => { appendText(i ? run(p, 'summary') : firstRun, (i ? '  ◇ ' : '◇ ') + item.label + ' '); appendText(run(p, 'summary', item.tone), '(' + item.status + ')'); });
        add(cell, 'hp:cellAddr', { colAddr: 0, rowAddr: 0 });
        add(cell, 'hp:cellSpan', { colSpan: 1, rowSpan: 1 });
        add(cell, 'hp:cellSz', { width, height: 282 });
        add(cell, 'hp:cellMargin', padding);
    };
    document.pages.forEach((page, pi) => page.blocks.forEach((block, bi) => {
        const style = block.kind === 'text' ? block.style : block.kind === 'metric' ? 'metric-body' : 'body', [p, r] = paragraph(root, style, pi > 0 && bi === 0);
        if (block.kind === 'text') {
            preview.push(block.text);
            if (style === 'summary')
                summary(r, block.text);
            else
                appendText(r, block.text);
        }
        else if (block.kind === 'summary') {
            summary(r, block);
            preview.push(block.items.map(i => '◇ ' + i.label + ' (' + i.status + ')').join('  '));
        }
        else if (block.kind === 'metric') {
            const label = '○ ' + block.title + ' ' + block.value + ' ', status = '[' + block.status + ']';
            appendText(r, label);
            appendText(run(p, 'metric-body', block.tone), status);
            preview.push(label + status);
            const lines: ReadonlyArray<readonly [
                string,
                ReportTextStyle
            ]> = [['- ' + block.narrative, 'metric-body'], ...(block.basis !== null ? [['기준: ' + block.basis, 'metric-note'] as const] : []), ['* ' + block.formula, 'metric-note']];
            for (const [t, s] of lines) {
                appendText(paragraph(root, s)[1], t);
                preview.push(t);
            }
            image(paragraph(root, 'body')[1], { kind: 'image', role: block.imageRole });
        }
        else
            image(r, block);
    }));
    parts['Contents/header.xml'] = xml(header);
    parts['Contents/section0.xml'] = xml(section);
    parts['Contents/content.hpf'] = xml(manifest);
    parts['Preview/PrvText.txt'] = encoder.encode(preview.join('\n'));
    delete parts['Preview/PrvImage.png'];
    return parts;
}
