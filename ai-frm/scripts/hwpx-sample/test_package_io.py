"""Generic HWPX package contract, independent of financial reports or page counts."""
import copy
import io
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import warnings
import xml.etree.ElementTree as ET
import zipfile

import package_io as package

ROOT = Path(__file__).parent
NS = {'hp': 'http://www.hancom.co.kr/hwpml/2011/paragraph',
      'hc': 'http://www.hancom.co.kr/hwpml/2011/core',
      'hh': 'http://www.hancom.co.kr/hwpml/2011/head',
      'opf': 'http://www.idpf.org/2007/opf/'}
PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082')


def raw_zip(parts, *, duplicate=None):
    result = io.BytesIO()
    with warnings.catch_warnings(), zipfile.ZipFile(result, 'w') as target:
        warnings.simplefilter('ignore', UserWarning)
        for name, payload in parts.items():
            target.writestr(name, payload)
        if duplicate:
            target.writestr(duplicate, parts[duplicate])
    return result.getvalue()


def with_image(parts):
    parts = copy.copy(parts)
    parts['BinData/probe.png'] = PNG
    manifest = ET.fromstring(parts['Contents/content.hpf'])
    ET.SubElement(manifest.find('opf:manifest', NS), '{'+NS['opf']+'}item', {
        'id': 'probe', 'href': 'BinData/probe.png', 'media-type': 'image/png', 'isEmbeded': '1'})
    parts['Contents/content.hpf'] = ET.tostring(manifest)
    section = ET.fromstring(parts['Contents/section0.xml'])
    ET.SubElement(section.find('.//hp:run', NS), '{'+NS['hc']+'}img', {'binaryItemIDRef': 'probe'})
    parts['Contents/section0.xml'] = ET.tostring(section)
    return parts


class PackageContract(unittest.TestCase):
    def setUp(self):
        with zipfile.ZipFile(ROOT/'blank.hwpx') as source:
            self.parts = {item.filename: source.read(item) for item in source.infolist()}

    def test_rejects_missing_part_and_broken_reference(self):
        missing = dict(self.parts)
        del missing['Contents/header.xml']
        self.assertIn('missing_part', {i.code for i in package.validate_parts(missing)})
        with self.assertRaises(ValueError):
            package.build_package(missing)
        broken = dict(self.parts)
        broken['Contents/section0.xml'] = broken['Contents/section0.xml'].replace(b'charPrIDRef="0"', b'charPrIDRef="999"')
        issues = package.validate_parts(broken)
        self.assertTrue(any(i.code == 'broken_reference' and i.part == 'Contents/section0.xml' for i in issues))
        with self.assertRaises(ValueError):
            package.read_package(raw_zip(broken))

    def test_rejects_duplicate_entries_and_corrupt_crc(self):
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            package.read_package(raw_zip(self.parts, duplicate='Contents/header.xml'))
        payload = bytearray(raw_zip(self.parts))
        name_len, extra_len = struct.unpack_from('<HH', payload, 26)
        payload[30+name_len+extra_len] ^= 1  # Stored first entry: corrupt bytes, unchanged CRC.
        with self.assertRaisesRegex(ValueError, 'CRC|crc|corrupt'):
            package.read_package(bytes(payload))

    def test_preserves_existing_output_on_validation_or_replace_failure(self):
        with tempfile.TemporaryDirectory() as td:
            target = Path(td)/'report.hwpx'
            target.write_bytes(b'previous accepted file')
            for payload in (b'not a zip', raw_zip({**self.parts, 'Contents/header.xml': b'<broken'})):
                with self.assertRaises(ValueError):
                    package.write_atomic(target, payload)
                self.assertEqual(target.read_bytes(), b'previous accepted file')
            valid = package.build_package(self.parts)
            with patch.object(package.os, 'replace', side_effect=OSError('replace failed')):
                with self.assertRaisesRegex(OSError, 'replace failed'):
                    package.write_atomic(target, valid)
            self.assertEqual(target.read_bytes(), b'previous accepted file')
            self.assertEqual(list(Path(td).iterdir()), [target])
            package.write_atomic(target, valid)
            self.assertEqual(package.read_package(target.read_bytes()), self.parts)
            self.assertEqual(list(Path(td).iterdir()), [target])

    def test_deterministic_package_preserves_input_and_single_image_bytes(self):
        parts = with_image(self.parts)
        before = copy.deepcopy(parts)
        self.assertEqual(package.validate_parts(parts), ())
        first = package.build_package(parts)
        self.assertEqual(first, package.build_package(dict(reversed(list(parts.items())))))
        self.assertEqual(parts, before)
        reopened = package.read_package(first)
        self.assertIn('BinData/probe.png', reopened)
        self.assertEqual(reopened['BinData/probe.png'], PNG)
        with zipfile.ZipFile(io.BytesIO(first)) as source:
            mime = source.infolist()[0]
            self.assertEqual(mime.filename, 'mimetype')
            self.assertEqual(mime.compress_type, zipfile.ZIP_STORED)
            self.assertTrue(all(i.date_time == (1980, 1, 1, 0, 0, 0) for i in source.infolist()))

    def test_rejects_missing_image_broken_spine_and_container(self):
        parts = with_image(self.parts)
        del parts['BinData/probe.png']
        self.assertIn('missing_part', {i.code for i in package.validate_parts(parts)})
        for name, old, new in [
            ('Contents/content.hpf', b'idref="section0"', b'idref="missing"'),
            ('META-INF/container.xml', b'Contents/content.hpf', b'Contents/missing.hpf'),
        ]:
            broken = dict(self.parts)
            broken[name] = broken[name].replace(old, new)
            self.assertTrue(package.validate_parts(broken), name)
        broken = with_image(self.parts)
        broken['Contents/section0.xml'] = broken['Contents/section0.xml'].replace(b'binaryItemIDRef="probe"', b'binaryItemIDRef="missing"')
        self.assertIn('broken_reference', {i.code for i in package.validate_parts(broken)})

    def test_spine_requires_a_section_and_picture_requires_an_image_target(self):
        parts = dict(self.parts)
        manifest = ET.fromstring(parts['Contents/content.hpf'])
        items = manifest.find('opf:manifest', NS)
        items.remove(items.find('opf:item[@id="section0"]', NS))
        spine = manifest.find('opf:spine', NS)
        spine.remove(spine.find('opf:itemref[@idref="section0"]', NS))
        parts['Contents/content.hpf'] = ET.tostring(manifest)
        del parts['Contents/section0.xml']
        self.assertIn('broken_reference', {i.code for i in package.validate_parts(parts)})
        parts = with_image(self.parts)
        parts['Contents/section0.xml'] = parts['Contents/section0.xml'].replace(b'binaryItemIDRef="probe"', b'binaryItemIDRef="header"')
        self.assertIn('broken_reference', {i.code for i in package.validate_parts(parts)})

    def test_font_ids_are_scoped_by_language_and_all_style_refs_are_checked(self):
        self.assertEqual(package.validate_parts(self.parts), ())
        for name, old, new in [
            ('Contents/header.xml', b'hangul="1"', b'hangul="999"'),
            ('Contents/header.xml', b'nextStyleIDRef="0"', b'nextStyleIDRef="999"'),
            ('Contents/section0.xml', b'paraPrIDRef="0"', b'paraPrIDRef="999"'),
            ('Contents/section0.xml', b'styleIDRef="0"', b'styleIDRef="999"'),
        ]:
            broken = dict(self.parts)
            broken[name] = broken[name].replace(old, new)
            self.assertIn('broken_reference', {i.code for i in package.validate_parts(broken)}, name+str(new))

    def test_rejects_ambiguous_paths_duplicate_ids_and_wrong_mime(self):
        for path in ('Contents/./header.xml', '../header.xml', '/header.xml', 'Contents\\header.xml', 'contents/header.xml'):
            parts = {**self.parts, path: b'alias'}
            with self.assertRaises(ValueError, msg=path):
                package.build_package(parts)
        bad = dict(self.parts)
        bad['Contents/content.hpf'] = bad['Contents/content.hpf'].replace(b'id="section0"', b'id="header"')
        self.assertIn('duplicate_id', {i.code for i in package.validate_parts(bad)})
        with self.assertRaises(ValueError):
            package.build_package({**self.parts, 'mimetype': b'application/zip'})
        compressed = io.BytesIO()
        with zipfile.ZipFile(compressed, 'w', compression=zipfile.ZIP_DEFLATED) as target:
            for name, payload in self.parts.items():
                target.writestr(name, payload)
        with self.assertRaisesRegex(ValueError, 'mimetype'):
            package.read_package(compressed.getvalue())


if __name__ == '__main__':
    unittest.main()
