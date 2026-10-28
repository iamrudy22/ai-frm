"""Semantic native-flow probes: content fidelity without PDF line coordinates."""
import copy
from dataclasses import FrozenInstanceError
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

from document_xml import build_parts, mm_to_hwp, pt_to_hwp
from package_io import read_package, validate_parts
from report_projection import ImageBlock, MetricBlock, PageSpec, ReportDocument, TextBlock

ROOT = Path(__file__).parent
NS = {'hp': 'http://www.hancom.co.kr/hwpml/2011/paragraph',
      'hs': 'http://www.hancom.co.kr/hwpml/2011/section',
      'hc': 'http://www.hancom.co.kr/hwpml/2011/core',
      'hh': 'http://www.hancom.co.kr/hwpml/2011/head',
      'opf': 'http://www.idpf.org/2007/opf/'}
PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082')


def document(*blocks):
    return ReportDocument('2026/08', '2026.10.29', (PageSpec(tuple(blocks)),))


def native_text(node):
    output = node.text or ''
    for child in node:
        output += '\n' if child.tag == '{'+NS['hp']+'}lineBreak' else native_text(child)
        output += child.tail or ''
    return output


def texts(parts):
    root = ET.fromstring(parts['Contents/section0.xml'])
    return [native_text(node) for node in root.findall('.//hp:t', NS)]


class NativeDocumentContract(unittest.TestCase):
    def setUp(self):
        self.template = read_package((ROOT/'blank.hwpx').read_bytes())

    def test_semantic_document_types_are_frozen(self):
        block = TextBlock('원문')
        with self.assertRaises(FrozenInstanceError):
            block.text = '변경'
        doc = document(block)
        with self.assertRaises(FrozenInstanceError):
            doc.report_month = '2026/09'
        self.assertIsInstance(doc.pages, tuple)
        self.assertIsInstance(doc.pages[0].blocks, tuple)

    def test_units_are_exact_and_non_finite_values_are_rejected(self):
        self.assertEqual(pt_to_hwp(1), 100)
        self.assertEqual(mm_to_hwp(25.4), 7200)
        for bad in (float('nan'), float('inf'), -1):
            with self.assertRaises(ValueError):
                pt_to_hwp(bad)
            with self.assertRaises(ValueError):
                mm_to_hwp(bad)

    def test_preserves_order_unicode_xml_escape_and_native_line_break(self):
        expected = ['합성 <보고서> & 검토', '2026.10.29', '한글 본문 첫 줄\n두 번째 줄 × ÷ − Σ', 'Gap = A − B ÷ C × 100']
        doc = document(*(TextBlock(text, style) for text, style in zip(expected, ('title', 'date', 'body', 'formula'))))
        parts = build_parts(doc, self.template, {})
        self.assertEqual(texts(parts), expected)
        root = ET.fromstring(parts['Contents/section0.xml'])
        self.assertEqual(len(root.findall('.//hp:lineBreak', NS)), 1)
        self.assertIn(b'&lt;', parts['Contents/section0.xml'])
        self.assertIn(b'&amp;', parts['Contents/section0.xml'])
        self.assertEqual(validate_parts(parts), ())

    def test_no_line_cache_or_fixed_spacing_and_original_section_controls_are_kept(self):
        parts = build_parts(document(TextBlock('두 줄이 되어도 문단이 자연스럽게 흐릅니다. '*4)), self.template, {})
        section = ET.fromstring(parts['Contents/section0.xml'])
        source = ET.fromstring(self.template['Contents/section0.xml'])
        for path in ('hp:p/hp:run/hp:secPr', 'hp:p/hp:run/hp:ctrl'):
            self.assertEqual(ET.tostring(section.find(path, NS)), ET.tostring(source.find(path, NS)))
        self.assertEqual(section.findall('.//hp:linesegarray', NS), [])
        header = ET.fromstring(parts['Contents/header.xml'])
        ref = section.find('hp:p', NS).get('paraPrIDRef')
        prop = header.find('.//hh:paraPr[@id="'+ref+'"]', NS)
        self.assertTrue(prop.findall('.//hh:lineSpacing', NS))
        self.assertTrue(all(s.get('type') == 'PERCENT' for s in prop.findall('.//hh:lineSpacing', NS)))

    def test_inserting_inline_image_keeps_body_order_and_original_image_bytes(self):
        first, last = TextBlock('차트 앞 원문'), TextBlock('차트 뒤 원문')
        plain = build_parts(document(first, last), self.template, {})
        parts = build_parts(document(first, ImageBlock('chart', 400, 120), last), self.template, {'chart': PNG, 'unused': b'not embedded'})
        self.assertEqual([text for text in texts(parts) if text], [text for text in texts(plain) if text])
        section = ET.fromstring(parts['Contents/section0.xml'])
        self.assertEqual(len(section.findall('hp:p', NS)), 3)
        picture = section.findall('hp:p', NS)[1].find('hp:run/hp:pic', NS)
        self.assertIsNotNone(picture)
        self.assertEqual(picture.get('textWrap'), 'SQUARE')
        pos = picture.find('hp:pos', NS)
        for key, value in {'treatAsChar':'1','flowWithText':'1','allowOverlap':'0','vertRelTo':'PARA','horzRelTo':'COLUMN','vertOffset':'0','horzOffset':'0'}.items():
            self.assertEqual(pos.get(key), value)
        self.assertEqual([child.tag.split('}')[-1] for child in picture], ['offset','orgSz','curSz','flip','rotationInfo','renderingInfo','imgRect','imgClip','inMargin','imgDim','img','effects','sz','pos','outMargin','shapeComment'])
        self.assertEqual(parts['BinData/chart.png'], PNG)
        self.assertNotIn('BinData/unused.png', parts)
        self.assertEqual(validate_parts(parts), ())

    def test_compatibility_default_margins_are_twice_case_values(self):
        parts = build_parts(document(TextBlock('본문'), TextBlock('절 제목','heading')), self.template, {})
        section = ET.fromstring(parts['Contents/section0.xml'])
        header = ET.fromstring(parts['Contents/header.xml'])
        for paragraph, name, expected in zip(section.findall('hp:p', NS), ('next','prev'), (600, 1000)):
            prop = header.find('.//hh:paraPr[@id="'+paragraph.get('paraPrIDRef')+'"]', NS)
            case = prop.find('hp:switch/hp:case/hh:margin/hc:'+name, NS)
            fallback = prop.find('hp:switch/hp:default/hh:margin/hc:'+name, NS)
            self.assertEqual(case.get('value'), str(expected))
            self.assertEqual(fallback.get('value'), str(expected*2))
            self.assertEqual((case.get('unit'), fallback.get('unit')), ('HWPUNIT','HWPUNIT'))

    def test_bold_character_format_uses_native_child_order(self):
        parts = build_parts(document(TextBlock('제목', 'title')), self.template, {})
        section = ET.fromstring(parts['Contents/section0.xml'])
        char_id = section.find('hp:p/hp:run', NS).get('charPrIDRef')
        header = ET.fromstring(parts['Contents/header.xml'])
        char = header.find('.//hh:charPr[@id="'+char_id+'"]', NS)
        names = [child.tag.split('}')[-1] for child in char]
        self.assertLess(names.index('bold'), names.index('underline'))

    def test_summary_is_editable_single_cell_with_native_fill_and_border(self):
        text = '◇ 합성 지표 (정상)\n◇ 두 번째 지표 (주의)'
        parts = build_parts(document(TextBlock(text, 'summary')), self.template, {})
        section = ET.fromstring(parts['Contents/section0.xml'])
        table = section.find('.//hp:tbl', NS)
        self.assertIsNotNone(table)
        self.assertEqual((table.get('rowCnt'), table.get('colCnt')), ('1', '1'))
        self.assertEqual(len(table.findall('hp:tr/hp:tc', NS)), 1)
        self.assertIn(text, texts(parts))
        header = ET.fromstring(parts['Contents/header.xml'])
        fill = header.find('.//hh:borderFill[@id="'+table.get('borderFillIDRef')+'"]', NS)
        self.assertEqual(fill.find('hc:fillBrush/hc:winBrush', NS).get('faceColor'), '#FFFDD4')
        self.assertTrue(all(fill.find('hh:'+name+'Border', NS).get('type') == 'SOLID' for name in ('left','right','top','bottom')))
        self.assertEqual(table.find('hp:pos', NS).get('treatAsChar'), '1')
        self.assertEqual(section.findall('.//hp:linesegarray', NS), [])
        self.assertEqual(validate_parts(parts), ())

    def test_rejects_unknown_style_missing_duplicate_or_invalid_image_role(self):
        bad_documents = [
            document(TextBlock('원문', 'unknown')),
            document(ImageBlock('chart', 100, 100)),
            document(ImageBlock('chart', 100, 100), ImageBlock('chart', 100, 100)),
            document(ImageBlock('../chart', 100, 100)),
            document(ImageBlock('chart', float('inf'), 100)),
            document(ImageBlock('chart', 0, 100)),
            document(ImageBlock('chart', 10000, 100)),
        ]
        for doc in bad_documents:
            with self.assertRaises(ValueError, msg=str(doc)):
                build_parts(doc, self.template, {} if len(doc.pages[0].blocks) == 1 and isinstance(doc.pages[0].blocks[0], ImageBlock) and doc.pages[0].blocks[0].role == 'chart' and doc.pages[0].blocks[0].width_pt == 100 else {'chart': PNG})
        with self.assertRaises(ValueError):
            build_parts(document(ImageBlock('chart', 100, 100)), self.template, {'chart': b'not PNG'})

    def test_repeated_body_is_legal_and_pages_have_only_semantic_boundaries(self):
        doc = ReportDocument('2026/08', '2026.10.29', (PageSpec((TextBlock('같은 문장'),)), PageSpec((TextBlock('같은 문장'), TextBlock('다음 문장')))))
        parts = build_parts(doc, self.template, {})
        self.assertEqual(texts(parts), ['같은 문장','같은 문장','다음 문장'])
        root = ET.fromstring(parts['Contents/section0.xml'])
        self.assertEqual(len(root.findall('hp:p[@pageBreak="1"]', NS)), 1)

    def test_manifest_explicitly_registers_version_without_duplicate_ids(self):
        doc = document(TextBlock('원문'))
        parts = build_parts(doc, self.template, {})
        manifest = ET.fromstring(parts['Contents/content.hpf'])
        items = manifest.findall('opf:manifest/opf:item', NS)
        self.assertEqual(len([item for item in items if item.get('href') == 'version.xml']), 1)
        self.assertEqual(len(items), len({item.get('id') for item in items}))
        again = build_parts(doc, parts, {})
        items = ET.fromstring(again['Contents/content.hpf']).findall('opf:manifest/opf:item', NS)
        self.assertEqual(len([item for item in items if item.get('href') == 'version.xml']), 1)
        self.assertEqual(len(items), len({item.get('id') for item in items}))
        occupied = dict(self.template)
        occupied['Contents/content.hpf'] = occupied['Contents/content.hpf'].replace(b'id="settings"', b'id="version"')
        parts = build_parts(doc, occupied, {})
        items = ET.fromstring(parts['Contents/content.hpf']).findall('opf:manifest/opf:item', NS)
        self.assertEqual(len([item for item in items if item.get('href') == 'version.xml']), 1)
        self.assertEqual(len(items), len({item.get('id') for item in items}))

    def test_template_assets_and_document_are_unchanged_and_bad_refs_are_rejected(self):
        doc = document(TextBlock('원문'), ImageBlock('chart', 100, 100))
        assets = {'chart': PNG}
        before = copy.deepcopy((doc, self.template, assets))
        one = build_parts(doc, self.template, assets)
        self.assertEqual((doc, self.template, assets), before)
        self.assertEqual(one, build_parts(doc, self.template, assets))
        bad = dict(self.template)
        bad['Contents/section0.xml'] = bad['Contents/section0.xml'].replace(b'charPrIDRef="0"', b'charPrIDRef="999"')
        with self.assertRaises(ValueError):
            build_parts(doc, bad, assets)
        with self.assertRaisesRegex(ValueError, 'MetricBlock'):
            build_parts(document(MetricBlock('제목','0','정상','문구','기준','산식','chart')), self.template, assets)


if __name__ == '__main__':
    unittest.main()
