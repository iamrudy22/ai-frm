"""Generic HWPX package integrity and atomic storage, without report policy.

Validation covers the references emitted by this exporter. It is not a complete
HWPX schema validator or evidence of layout compatibility in a document viewer.
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
import io
import os
from pathlib import Path, PurePosixPath
import tempfile
import xml.etree.ElementTree as ET
import zipfile

NS = {
    'hp': 'http://www.hancom.co.kr/hwpml/2011/paragraph',
    'hs': 'http://www.hancom.co.kr/hwpml/2011/section',
    'hc': 'http://www.hancom.co.kr/hwpml/2011/core',
    'hh': 'http://www.hancom.co.kr/hwpml/2011/head',
    'opf': 'http://www.idpf.org/2007/opf/',
    'ocf': 'urn:oasis:names:tc:opendocument:xmlns:container',
}
MIME = b'application/hwp+zip'


@dataclass(frozen=True)
class PackageIssue:
    part: str
    code: str
    message: str


def _path_issue(name: str) -> str | None:
    if not name or '\\' in name or '\x00' in name:
        return 'non-canonical package path'
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or str(path) != name:
        return 'non-canonical package path'
    return None


def validate_parts(parts: Mapping[str, bytes]) -> tuple[PackageIssue, ...]:
    """Return precise package/reference issues without mutating input bytes."""
    issues: list[PackageIssue] = []

    def issue(part, code, message):
        issues.append(PackageIssue(part, code, message))

    paths = set()
    xml = {}
    for name, payload in parts.items():
        problem = _path_issue(name)
        if problem:
            issue(name, 'invalid_path', problem)
        if name.casefold() in paths:
            issue(name, 'duplicate_path', 'case-colliding package path')
        paths.add(name.casefold())
        if name.endswith(('.xml', '.hpf', '.rdf')):
            try:
                xml[name] = ET.fromstring(payload)
            except ET.ParseError as exc:
                issue(name, 'invalid_xml', str(exc))
    for name in ('mimetype', 'version.xml', 'META-INF/container.xml',
                 'Contents/content.hpf', 'Contents/header.xml'):
        if name not in parts:
            issue(name, 'missing_part', 'required package part is absent')
    if parts.get('mimetype') != MIME:
        issue('mimetype', 'invalid_mime', 'expected application/hwp+zip')

    container = xml.get('META-INF/container.xml')
    if container is not None:
        roots = container.findall('ocf:rootfiles/ocf:rootfile', NS)
        if not any(r.get('full-path') == 'Contents/content.hpf' for r in roots):
            issue('META-INF/container.xml', 'broken_reference', 'package root is not declared')
        for root in roots:
            if root.get('full-path') not in parts:
                issue('META-INF/container.xml', 'missing_part', 'rootfile '+str(root.get('full-path'))+' is absent')

    manifest = xml.get('Contents/content.hpf')
    manifest_ids = {}
    if manifest is not None:
        for item in manifest.findall('opf:manifest/opf:item', NS):
            identifier, href = item.get('id'), item.get('href')
            if not identifier or identifier in manifest_ids:
                issue('Contents/content.hpf', 'duplicate_id', 'missing or duplicate manifest id '+str(identifier))
            manifest_ids[identifier] = item
            if href not in parts:
                issue('Contents/content.hpf', 'missing_part', 'manifest target '+str(href)+' is absent')
            elif item.get('media-type') == 'image/png' and not parts[href].startswith(b'\x89PNG\r\n\x1a\n'):
                issue(href, 'invalid_image', 'declared PNG lacks its signature')
        spine = manifest.findall('opf:spine/opf:itemref', NS)
        if not spine:
            issue('Contents/content.hpf', 'broken_reference', 'document spine is empty')
        section_targets = {name for name, root in xml.items() if root.tag == '{'+NS['hs']+'}sec'}
        if not any(manifest_ids.get(item.get('idref')) is not None
                   and manifest_ids[item.get('idref')].get('href') in section_targets for item in spine):
            issue('Contents/content.hpf', 'broken_reference', 'spine contains no document section')
        for item in spine:
            if item.get('idref') not in manifest_ids:
                issue('Contents/content.hpf', 'broken_reference', 'spine idref '+str(item.get('idref'))+' is absent')

    header = xml.get('Contents/header.xml')
    reference_sets = {}
    attribute_groups = {
        'charPrIDRef': 'charPr', 'paraPrIDRef': 'paraPr',
        'styleIDRef': 'style', 'nextStyleIDRef': 'style',
        'borderFillIDRef': 'borderFill', 'tabPrIDRef': 'tabPr',
    }
    if header is not None:
        for group in set(attribute_groups.values()):
            identifiers = [e.get('id') for e in header.findall('.//hh:'+group, NS)]
            if None in identifiers or len(identifiers) != len(set(identifiers)):
                issue('Contents/header.xml', 'duplicate_id', 'missing or duplicate '+group+' id')
            reference_sets[group] = set(identifiers)
        fonts = {}
        for face in header.findall('.//hh:fontface', NS):
            language = face.get('lang', '').lower()
            identifiers = [font.get('id') for font in face.findall('hh:font', NS)]
            if language in fonts or None in identifiers or len(identifiers) != len(set(identifiers)):
                issue('Contents/header.xml', 'duplicate_id', 'duplicate font id/language '+language)
            fonts[language] = set(identifiers)
        for ref in header.findall('.//hh:fontRef', NS):
            for language, identifier in ref.attrib.items():
                if identifier not in fonts.get(language, set()):
                    issue('Contents/header.xml', 'broken_reference', 'font '+language+':'+identifier+' is absent')

    for name, document in xml.items():
        for node in document.iter():
            for attribute, group in attribute_groups.items():
                identifier = node.get(attribute)
                if identifier is None:
                    continue
                # HWPX numbering paragraph heads use UINT_MAX for inherited font.
                if (attribute == 'charPrIDRef' and identifier == '4294967295'
                        and node.tag == '{'+NS['hh']+'}paraHead'):
                    continue
                if identifier not in reference_sets.get(group, set()):
                    issue(name, 'broken_reference', attribute+'='+identifier+' is absent')
            binary_id = node.get('binaryItemIDRef')
            if binary_id is not None:
                target = manifest_ids.get(binary_id)
                if (target is None or target.get('href') not in parts
                        or (node.tag == '{'+NS['hc']+'}img'
                            and not target.get('media-type', '').startswith('image/'))):
                    issue(name, 'broken_reference', 'binaryItemIDRef='+binary_id+' lacks a valid target')
    return tuple(issues)


def _require_valid(parts: Mapping[str, bytes]) -> None:
    issues = validate_parts(parts)
    if issues:
        raise ValueError('; '.join(i.part+': '+i.code+': '+i.message for i in issues))


def read_package(payload: bytes) -> dict[str, bytes]:
    """Read a package once, rejecting duplicate paths, CRC damage and bad refs."""
    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as source:
            entries = source.infolist()
            names = [entry.filename for entry in entries]
            if len(names) != len(set(names)):
                raise ValueError('duplicate package entry')
            # Read all parts before checking MIME contents so CRC failures remain
            # distinguishable from a structurally invalid, intact package.
            parts = {entry.filename: source.read(entry) for entry in entries}
            if not entries or entries[0].filename != 'mimetype' or entries[0].compress_type != zipfile.ZIP_STORED:
                raise ValueError('mimetype must be the first, uncompressed entry')
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError, EOFError) as exc:
        raise ValueError('corrupt HWPX ZIP: '+str(exc)) from exc
    _require_valid(parts)
    return parts


def build_package(parts: Mapping[str, bytes]) -> bytes:
    """Build deterministic ZIP bytes after generic package validation."""
    _require_valid(parts)
    result = io.BytesIO()
    with zipfile.ZipFile(result, 'w') as target:
        for name in ['mimetype', *sorted(n for n in parts if n != 'mimetype')]:
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED if name == 'mimetype' else zipfile.ZIP_DEFLATED
            target.writestr(info, parts[name])
    return result.getvalue()


def write_atomic(path: Path, payload: bytes) -> None:
    """Validate candidate bytes before replacing any existing accepted output."""
    read_package(payload)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.'+path.name+'-', suffix='.tmp', delete=False) as target:
            temporary = Path(target.name)
            target.write(payload)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
