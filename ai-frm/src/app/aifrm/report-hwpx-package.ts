/** Generic HWPX package integrity. This is not a complete HWPX schema validator. */
import { inflateSync, zipSync, type Zippable } from 'fflate';

export type HwpxParts = Readonly<Record<string, Uint8Array>>;
export type PackageIssue = Readonly<{ part: string; code: string; message: string }>;
const MIME = 'application/hwp+zip';
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_ZIP = 64 * 1024 * 1024;
const MAX_PART = 24 * 1024 * 1024;
const MAX_TOTAL = 96 * 1024 * 1024;
const MAX_ENTRIES = 512;
const NS = {
  hs: 'http://www.hancom.co.kr/hwpml/2011/section',
  hc: 'http://www.hancom.co.kr/hwpml/2011/core',
  hh: 'http://www.hancom.co.kr/hwpml/2011/head',
  opf: 'http://www.idpf.org/2007/opf/',
  ocf: 'urn:oasis:names:tc:opendocument:xmlns:container',
};
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
export function crc32(payload: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of payload) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
export function parseHwpxXml(payload: Uint8Array, partName: string): XMLDocument {
  try {
    if (payload.length > 8 * 1024 * 1024) throw new Error('XML size limit exceeded');
    const source = decoder.decode(payload);
    // HWPX parts need no DTD. Reject before a parser can expand internal entities.
    if (source.includes('<!DOCTYPE')) throw new Error('DTD is not supported');
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    if (!doc.documentElement || doc.doctype || doc.getElementsByTagNameNS('*', 'parsererror').length) {
      throw new Error('malformed XML');
    }
    return doc;
  } catch (error) {
    throw new Error(`${partName}: invalid_xml: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function pathIssue(name: string): boolean {
  return !name || name.includes('\\') || name.includes('\0') || name.startsWith('/')
    || name.split('/').some((segment) => !segment || segment === '.' || segment === '..');
}
const elements = (root: Document | Element, ns: string, name: string): Element[] =>
  Array.from(root.getElementsByTagNameNS(ns, name));
const children = (root: Element | undefined, ns: string, name: string): Element[] => root
  ? Array.from(root.childNodes).filter((node): node is Element => node.nodeType === 1
    && (node as Element).namespaceURI === ns && (node as Element).localName === name) : [];

function validateParts(parts: HwpxParts): PackageIssue[] {
  const issues: PackageIssue[] = [];
  const issue = (part: string, code: string, message: string) => { issues.push({ part, code, message }); };
  const paths = new Set<string>();
  const xml = new Map<string, XMLDocument>();
  let total = 0;
  const names = Object.keys(parts);
  if (names.length > MAX_ENTRIES) issue('', 'size_limit', 'package entry limit exceeded');
  for (const [name, payload] of Object.entries(parts)) {
    total += payload.length;
    if (payload.length > MAX_PART || total > MAX_TOTAL) issue(name, 'size_limit', 'package extraction size limit exceeded');
    if (pathIssue(name)) issue(name, 'invalid_path', 'non-canonical package path');
    if (paths.has(name.toLowerCase())) issue(name, 'duplicate_path', 'case-colliding package path');
    paths.add(name.toLowerCase());
    if (name.endsWith('.xml') || name.endsWith('.hpf') || name.endsWith('.rdf')) {
      try { xml.set(name, parseHwpxXml(payload, name)); }
      catch (error) { issue(name, 'invalid_xml', error instanceof Error ? error.message : String(error)); }
    }
  }
  for (const name of ['mimetype', 'version.xml', 'META-INF/container.xml', 'Contents/content.hpf', 'Contents/header.xml']) {
    if (!Object.hasOwn(parts, name)) issue(name, 'missing_part', 'required package part is absent');
  }
  const mime = parts.mimetype;
  if (!mime || mime.length !== MIME.length || !mime.every((byte, index) => byte === MIME.charCodeAt(index))) {
    issue('mimetype', 'invalid_mime', `expected ${MIME}`);
  }
  const container = xml.get('META-INF/container.xml');
  if (container) {
    const roots = children(children(container.documentElement, NS.ocf, 'rootfiles')[0], NS.ocf, 'rootfile');
    if (!roots.some((root) => root.getAttribute('full-path') === 'Contents/content.hpf')) {
      issue('META-INF/container.xml', 'broken_reference', 'package root is not declared');
    }
    for (const root of roots) {
      const path = root.getAttribute('full-path') ?? '';
      if (!Object.hasOwn(parts, path)) issue('META-INF/container.xml', 'missing_part', `rootfile ${path} is absent`);
    }
  }
  const manifestIds = new Map<string, Element>();
  const manifest = xml.get('Contents/content.hpf');
  if (manifest) {
    for (const item of children(children(manifest.documentElement, NS.opf, 'manifest')[0], NS.opf, 'item')) {
      const id = item.getAttribute('id') ?? '';
      const href = item.getAttribute('href') ?? '';
      if (!id || manifestIds.has(id)) issue('Contents/content.hpf', 'duplicate_id', `missing or duplicate manifest id ${id}`);
      manifestIds.set(id, item);
      if (!Object.hasOwn(parts, href)) issue('Contents/content.hpf', 'missing_part', `manifest target ${href} is absent`);
      else if (item.getAttribute('media-type') === 'image/png'
        && ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => parts[href][index] === byte)) {
        issue(href, 'invalid_image', 'declared PNG lacks its signature');
      }
    }
    const spine = children(children(manifest.documentElement, NS.opf, 'spine')[0], NS.opf, 'itemref');
    if (!spine.length) issue('Contents/content.hpf', 'broken_reference', 'document spine is empty');
    const sectionTargets = new Set([...xml].filter(([, doc]) => doc.documentElement.namespaceURI === NS.hs
      && doc.documentElement.localName === 'sec').map(([name]) => name));
    if (!spine.some((item) => sectionTargets.has(manifestIds.get(item.getAttribute('idref') ?? '')?.getAttribute('href') ?? ''))) {
      issue('Contents/content.hpf', 'broken_reference', 'spine contains no document section');
    }
    for (const item of spine) {
      if (!manifestIds.has(item.getAttribute('idref') ?? '')) issue('Contents/content.hpf', 'broken_reference', `spine idref ${item.getAttribute('idref')} is absent`);
    }
  }
  const attributeGroups: Record<string, string> = {
    charPrIDRef: 'charPr', paraPrIDRef: 'paraPr', styleIDRef: 'style', nextStyleIDRef: 'style',
    borderFillIDRef: 'borderFill', tabPrIDRef: 'tabPr',
  };
  const referenceSets = new Map<string, Set<string>>();
  const header = xml.get('Contents/header.xml');
  if (header) {
    for (const group of new Set(Object.values(attributeGroups))) {
      const identifiers = elements(header, NS.hh, group).map((element) => element.getAttribute('id'));
      if (identifiers.includes(null) || new Set(identifiers).size !== identifiers.length) issue('Contents/header.xml', 'duplicate_id', `missing or duplicate ${group} id`);
      referenceSets.set(group, new Set(identifiers.filter((id): id is string => id !== null)));
    }
    const fonts = new Map<string, Set<string>>();
    for (const face of elements(header, NS.hh, 'fontface')) {
      const language = (face.getAttribute('lang') ?? '').toLowerCase();
      const identifiers = children(face, NS.hh, 'font').map((font) => font.getAttribute('id'));
      if (fonts.has(language) || identifiers.includes(null) || new Set(identifiers).size !== identifiers.length) {
        issue('Contents/header.xml', 'duplicate_id', `duplicate font id/language ${language}`);
      }
      fonts.set(language, new Set(identifiers.filter((id): id is string => id !== null)));
    }
    for (const ref of elements(header, NS.hh, 'fontRef')) {
      for (const attr of Array.from(ref.attributes)) {
        if (!fonts.get(attr.name)?.has(attr.value)) issue('Contents/header.xml', 'broken_reference', `font ${attr.name}:${attr.value} is absent`);
      }
    }
  }
  for (const [name, doc] of xml) {
    for (const node of elements(doc, '*', '*')) {
      for (const [attribute, group] of Object.entries(attributeGroups)) {
        const id = node.getAttribute(attribute);
        if (id === null) continue;
        if (attribute === 'charPrIDRef' && id === '4294967295' && node.namespaceURI === NS.hh && node.localName === 'paraHead') continue;
        if (!referenceSets.get(group)?.has(id)) issue(name, 'broken_reference', `${attribute}=${id} is absent`);
      }
      const binary = node.getAttribute('binaryItemIDRef');
      if (binary !== null) {
        const target = manifestIds.get(binary);
        if (!target || !Object.hasOwn(parts, target.getAttribute('href') ?? '')
          || (node.namespaceURI === NS.hc && node.localName === 'img' && !(target.getAttribute('media-type') ?? '').startsWith('image/'))) {
          issue(name, 'broken_reference', `binaryItemIDRef=${binary} lacks a valid target`);
        }
      }
    }
  }
  return issues;
}
function requireValid(parts: HwpxParts) {
  const issues = validateParts(parts);
  if (issues.length) throw new Error(issues.map((issue) => `${issue.part}: ${issue.code}: ${issue.message}`).join('; '));
}

type ZipEntry = { name: string; flags: number; method: number; crc: number; size: number; compressed: number; offset: number };
/** Inspect central + local headers ourselves: fflate unzip does not check CRC or duplicate names. */
function extractZip(payload: Uint8Array): HwpxParts {
  const fail = (message: string): never => { throw new Error(`corrupt HWPX ZIP: ${message}`); };
  if (payload.length > MAX_ZIP) fail('ZIP size limit exceeded');
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const bounds = (offset: number, size: number) => { if (offset < 0 || offset + size > payload.length) fail('truncated ZIP'); };
  const u16 = (offset: number) => { bounds(offset, 2); return view.getUint16(offset, true); };
  const u32 = (offset: number) => { bounds(offset, 4); return view.getUint32(offset, true); };
  let end = -1;
  for (let offset = payload.length - 22; offset >= Math.max(0, payload.length - 65557); offset--) {
    if (u32(offset) === 0x06054b50 && offset + 22 + u16(offset + 20) === payload.length) { end = offset; break; }
  }
  if (end < 0) fail('end record is absent');
  const count = u16(end + 10);
  if (!count || count > MAX_ENTRIES) fail('package entry count limit exceeded');
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count) fail('multi-disk ZIP is unsupported');
  const centralSize = u32(end + 12);
  const centralOffset = u32(end + 16);
  if (centralOffset + centralSize !== end) fail('invalid central directory size');
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let cursor = centralOffset;
  let total = 0;
  for (let index = 0; index < count; index++) {
    bounds(cursor, 46);
    if (u32(cursor) !== 0x02014b50) fail('invalid central entry');
    const flags = u16(cursor + 8), method = u16(cursor + 10), crc = u32(cursor + 16);
    const compressed = u32(cursor + 20), size = u32(cursor + 24), offset = u32(cursor + 42);
    const nameLength = u16(cursor + 28), extraLength = u16(cursor + 30), commentLength = u16(cursor + 32);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    bounds(cursor, next - cursor);
    if (next > end || u16(cursor + 34) !== 0) fail('invalid central entry bounds');
    if (flags & ~0x080e || flags & 1 || ![0, 8].includes(method)) fail('unsupported encryption, flags or compression');
    total += size;
    if (size > MAX_PART || total > MAX_TOTAL || compressed > MAX_ZIP) fail('package extraction size limit exceeded');
    const name = decoder.decode(payload.subarray(cursor + 46, cursor + 46 + nameLength));
    if (names.has(name)) fail(`duplicate package entry ${name}`);
    names.add(name);
    if (pathIssue(name)) fail(`invalid_path: ${name}`);
    entries.push({ name, flags, method, crc, size, compressed, offset });
    cursor = next;
  }
  if (cursor !== end) fail('central directory entry count/size mismatch');
  if (entries[0].name !== 'mimetype' || entries[0].method !== 0 || entries[0].offset !== 0) fail('mimetype must be the first, uncompressed entry');
  const parts: Record<string, Uint8Array> = Object.create(null);
  let localCursor = 0;
  for (const entry of [...entries].sort((a, b) => a.offset - b.offset)) {
    const { name, offset, flags, method, crc, compressed, size } = entry;
    if (offset !== localCursor || u32(offset) !== 0x04034b50) fail('invalid or overlapping local entry');
    if (u16(offset + 6) !== flags || u16(offset + 8) !== method) fail('local/central compression mismatch');
    const nameLength = u16(offset + 26), extraLength = u16(offset + 28);
    const start = offset + 30 + nameLength + extraLength;
    bounds(offset, start - offset + compressed);
    if (start + compressed > centralOffset) fail('entry overlaps central directory');
    if (decoder.decode(payload.subarray(offset + 30, offset + 30 + nameLength)) !== name) fail('local/central name mismatch');
    if (!(flags & 8) && (u32(offset + 14) !== crc || u32(offset + 18) !== compressed || u32(offset + 22) !== size)) fail('local/central CRC or size mismatch');
    const stored = payload.subarray(start, start + compressed);
    // A caller-supplied output buffer bounds allocations even for forged DEFLATE size metadata.
    const bytes = method === 0 ? stored.slice() : inflateSync(stored, { out: new Uint8Array(size + 1) });
    if (bytes.length !== size) fail(`size mismatch for ${name}`);
    if (crc32(bytes) !== crc) fail(`CRC mismatch for ${name}`);
    parts[name] = bytes.slice();
    localCursor = start + compressed;
    if (flags & 8) {
      if (u32(localCursor) === 0x08074b50) localCursor += 4;
      if (u32(localCursor) !== crc || u32(localCursor + 4) !== compressed || u32(localCursor + 8) !== size) fail('invalid data descriptor');
      localCursor += 12;
    }
  }
  if (localCursor !== centralOffset) fail('unlisted local entry or trailing data');
  return parts;
}
export function readHwpxPackage(payload: Uint8Array): HwpxParts {
  const parts = extractZip(payload);
  requireValid(parts);
  return parts;
}
export function buildHwpxPackage(parts: HwpxParts): Uint8Array {
  requireValid(parts);
  const entries: Zippable = Object.create(null);
  for (const name of ['mimetype', ...Object.keys(parts).filter((name) => name !== 'mimetype').sort()]) {
    // fflate writes DOS local wall time, so never use UTC ISO dates or epoch zero here.
    entries[name] = [parts[name].slice(), { level: name === 'mimetype' ? 0 : 6, mtime: new Date(1980, 0, 1, 0, 0, 0) }];
  }
  const payload = zipSync(entries);
  if (payload.length > MAX_ZIP) throw new Error('ZIP size limit exceeded');
  return payload;
}
export function validateHwpxPackage(payload: Uint8Array): readonly PackageIssue[] {
  let parts: HwpxParts;
  try { parts = extractZip(payload); }
  catch (error) { return [{ part: '', code: 'invalid_zip', message: error instanceof Error ? error.message : String(error) }]; }
  return validateParts(parts);
}
