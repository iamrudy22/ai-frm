import { readFileSync } from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildHwpxPackage, crc32, parseHwpxXml, readHwpxPackage, validateHwpxPackage, type HwpxParts } from './report-hwpx-package';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const original = new Uint8Array(readFileSync(new URL('../../../scripts/hwpx-sample/blank.hwpx', import.meta.url)));
const blank = unzipSync(original);
const png = Uint8Array.from(Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082', 'hex'));
beforeAll(() => {
  vi.stubGlobal('DOMParser', class extends DOMParser {
    constructor() { super({ onError: (_level, message) => { throw new Error(message); } }); }
  });
  vi.stubGlobal('XMLSerializer', XMLSerializer);
});
function rawZip(parts: HwpxParts, compressedMime = false) {
  const entries: Zippable = {};
  for (const [name, bytes] of Object.entries(parts)) entries[name] = [bytes, { level: name === 'mimetype' && !compressedMime ? 0 : 6, mtime: new Date(1980, 0, 1) }];
  return zipSync(entries);
}
function replaced(parts: HwpxParts, part: string, old: string, next: string) {
  expect(decoder.decode(parts[part])).toContain(old);
  return { ...parts, [part]: encoder.encode(decoder.decode(parts[part]).replaceAll(old, next)) };
}
function withImage(): HwpxParts {
  let parts: HwpxParts = { ...blank, 'BinData/probe.png': png };
  parts = replaced(parts, 'Contents/content.hpf', '</opf:manifest>', '<opf:item id="probe" href="BinData/probe.png" media-type="image/png"/></opf:manifest>');
  return replaced(parts, 'Contents/section0.xml', '</hp:run>', '<hc:img binaryItemIDRef="probe"/></hp:run>');
}

describe('일반 HWPX 패키지 경계', () => {
  it('실제 blank를 열고 CRC32 표준값과 네임스페이스 XML을 읽는다', () => {
    expect(readHwpxPackage(original)).toEqual(blank);
    expect(validateHwpxPackage(original)).toEqual([]);
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
    const doc = parseHwpxXml(encoder.encode('<a:r xmlns:a="urn:test">한글 &amp; 값</a:r>'), 'probe.xml');
    expect(doc.documentElement.namespaceURI).toBe('urn:test');
    expect(doc.documentElement.textContent).toBe('한글 & 값');
    expect(() => parseHwpxXml(encoder.encode('<broken>'), 'broken.xml')).toThrow(/broken.xml/);
  });
  it('순서가 다른 입력에도 같은 ZIP을 만들고 MIME 첫 무압축·1980 DOS 날짜와 원본/그림 바이트를 보존한다', () => {
    const parts = withImage();
    const before = structuredClone(parts);
    const first = buildHwpxPackage(parts);
    expect(first).toEqual(buildHwpxPackage(Object.fromEntries(Object.entries(parts).reverse())));
    expect(parts).toEqual(before);
    expect(readHwpxPackage(first)).toEqual(parts);
    const view = new DataView(first.buffer, first.byteOffset, first.byteLength);
    expect(view.getUint16(8, true)).toBe(0);
    expect(decoder.decode(first.subarray(30, 38))).toBe('mimetype');
    for (let offset = 0; offset + 46 <= first.length; offset++) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        expect(view.getUint16(offset + 12, true)).toBe(0);
        expect(view.getUint16(offset + 14, true)).toBe(33);
      }
    }
    const reopened = readHwpxPackage(first);
    reopened['BinData/probe.png'][0] = 0;
    expect(parts['BinData/probe.png']).toEqual(png);
    expect(readHwpxPackage(first)['BinData/probe.png']).toEqual(png);
  });
  it('CRC 손상·중복 ZIP 이름·case 충돌·MIME 압축/순서 오류를 거부한다', () => {
    const crcBad = rawZip(blank);
    const view = new DataView(crcBad.buffer);
    crcBad[30 + view.getUint16(26, true) + view.getUint16(28, true)] ^= 1;
    expect(() => readHwpxPackage(crcBad)).toThrow(/CRC|corrupt/i);
    const duplicate = rawZip({ ...blank, 'Contents/zeader.xml': blank['Contents/header.xml'] });
    const from = encoder.encode('Contents/zeader.xml');
    for (let i = 0; i <= duplicate.length - from.length; i++) {
      if (from.every((byte, n) => duplicate[i + n] === byte)) duplicate.set(encoder.encode('Contents/header.xml'), i);
    }
    expect(() => readHwpxPackage(duplicate)).toThrow(/duplicate/i);
    expect(() => buildHwpxPackage({ ...blank, 'contents/header.xml': blank['Contents/header.xml'] })).toThrow(/duplicate_path/);
    expect(() => readHwpxPackage(rawZip(blank, true))).toThrow(/mimetype/);
    expect(() => readHwpxPackage(rawZip(Object.fromEntries(Object.entries(blank).reverse())))).toThrow(/mimetype/);
  });
  it.each(['Contents/./alias.xml', '../alias.xml', '/alias.xml', 'Contents\\alias.xml', 'Contents//alias.xml', 'Contents/alias.xml/'])('비정규 경로 %s를 거부한다', (name) => {
    expect(() => buildHwpxPackage({ ...blank, [name]: encoder.encode('<alias/>') })).toThrow(/invalid_path/);
  });
  it.each([
    ['Contents/section0.xml', 'charPrIDRef="0"', 'charPrIDRef="999"'],
    ['Contents/section0.xml', 'paraPrIDRef="0"', 'paraPrIDRef="999"'],
    ['Contents/section0.xml', 'styleIDRef="0"', 'styleIDRef="999"'],
    ['Contents/header.xml', 'nextStyleIDRef="0"', 'nextStyleIDRef="999"'],
    ['Contents/header.xml', 'hangul="1"', 'hangul="999"'],
    ['Contents/content.hpf', 'idref="section0"', 'idref="missing"'],
    ['META-INF/container.xml', 'Contents/content.hpf', 'Contents/missing.hpf'],
  ])('%s의 참조 %s를 검사한다', (name, old, next) => {
    const parts = replaced(blank, name, old, next);
    expect(validateHwpxPackage(rawZip(parts)).length).toBeGreaterThan(0);
    expect(() => buildHwpxPackage(parts)).toThrow(/broken_reference|missing_part/);
  });
  it('필수 part·빈 spine·중복 ID·그림 target/signature·손상 XML을 검사한다', () => {
    const missing = { ...blank };
    delete missing['Contents/header.xml'];
    expect(validateHwpxPackage(rawZip(missing))).toContainEqual(expect.objectContaining({ code: 'missing_part', part: 'Contents/header.xml' }));
    expect(() => buildHwpxPackage(replaced(blank, 'Contents/content.hpf', 'id="section0"', 'id="header"'))).toThrow(/duplicate_id/);
    expect(() => buildHwpxPackage(replaced(blank, 'Contents/content.hpf', 'idref="section0"', 'idref="header"'))).toThrow(/spine contains no document section/);
    expect(() => buildHwpxPackage(replaced(withImage(), 'Contents/section0.xml', 'binaryItemIDRef="probe"', 'binaryItemIDRef="header"'))).toThrow(/binaryItemIDRef/);
    expect(() => buildHwpxPackage({ ...withImage(), 'BinData/probe.png': encoder.encode('not a png') })).toThrow(/invalid_image/);
    expect(() => buildHwpxPackage({ ...blank, 'Contents/header.xml': encoder.encode('<broken') })).toThrow(/invalid_xml/);
    expect(() => buildHwpxPackage({ ...blank, mimetype: encoder.encode('application/zip') })).toThrow(/invalid_mime/);
  });
  it('선언된 추출 크기 한계·손상 ZIP·DTD를 거부한다', () => {
    const oversize = rawZip(blank);
    const view = new DataView(oversize.buffer);
    for (let i = 0; i < oversize.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 24, 0x7fffffff, true); break; }
    }
    expect(() => readHwpxPackage(oversize)).toThrow(/limit|size/i);
    expect(validateHwpxPackage(encoder.encode('not a ZIP'))).toContainEqual(expect.objectContaining({ code: 'invalid_zip' }));
    expect(() => parseHwpxXml(encoder.encode('<!DOCTYPE r [<!ENTITY x "value">]><r>&x;</r>'), 'dtd.xml')).toThrow();
  });
});
