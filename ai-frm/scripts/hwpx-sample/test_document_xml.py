"""Semantic native-flow probes: content fidelity without PDF line coordinates."""
import copy
import hashlib
import json
import struct
import zlib
from dataclasses import FrozenInstanceError
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

from document_xml import build_parts, mm_to_hwp, pt_to_hwp
from package_io import build_package, read_package, validate_parts
from report_projection import (ImageBlock, MetricBlock, PageSpec, ReportDocument,
                               SummaryBlock, SummaryItem, TextBlock, project_report)

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


def report_document(*blocks):
    return ReportDocument('2026/08', '2026.10.29', (PageSpec(blocks),), 'report')


def png(width, height):
    """Real synthetic PNG with independently chosen intrinsic pixel dimensions."""
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress((b'\0' + b'\0\0\0\xff' * width) * height))
            + chunk(b'IEND', b''))


def png_container(width=1, height=1, *, color=6, depth=8, interlace=0,
                  compressed=None, before_data=(), after_data=()):
    """Controlled CRC-valid containers, including deliberately invalid pixel streams."""
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))
    header = struct.pack('>IIBBBBB', width, height, depth, color, 0, 0, interlace)
    data = zlib.compress(b'\0\0\0\0\xff') if compressed is None else compressed
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header)
            + b''.join(chunk(kind, payload) for kind, payload in before_data)
            + chunk(b'IDAT', data)
            + b''.join(chunk(kind, payload) for kind, payload in after_data)
            + chunk(b'IEND', b''))


class NativeReportContract(unittest.TestCase):
    def setUp(self):
        self.template = read_package((ROOT/'blank.hwpx').read_bytes())

    def build(self, doc, assets=None):
        try:
            return build_parts(doc, self.template, assets or {})
        except ValueError as error:
            self.fail('report semantic serialization is missing: ' + str(error))

    def trees(self, parts):
        return (ET.fromstring(parts['Contents/section0.xml']), ET.fromstring(parts['Contents/header.xml']))

    def char(self, header, run):
        return header.find('.//hh:charPr[@id="'+run.get('charPrIDRef')+'"]', NS)

    def para(self, header, paragraph):
        return header.find('.//hh:paraPr[@id="'+paragraph.get('paraPrIDRef')+'"]', NS)

    def test_metric_block_keeps_text_and_image_in_flow(self):
        # Catches omitted/reordered/duplicated content, lost status tone or floating charts.
        metric = MetricBlock('대금 <회수>', '1.00', '주의', '기존 판정 & 설명', None,
                             'A ÷ B × 100', 'recovery', 'crisis')
        parts = self.build(report_document(TextBlock('앞'), metric, TextBlock('뒤')), {'recovery': png(400, 100)})
        section, header = self.trees(parts)
        paragraphs = section.findall('hp:p', NS)
        self.assertEqual([''.join(native_text(t) for t in p.findall('hp:run/hp:t', NS)) for p in paragraphs],
                         ['앞', '○ 대금 <회수> 1.00 [주의]', '- 기존 판정 & 설명', '* A ÷ B × 100', '', '뒤'])
        status_run = paragraphs[1].findall('hp:run', NS)[-1]
        self.assertEqual(native_text(status_run.find('hp:t', NS)), '[주의]')
        self.assertEqual(self.char(header, status_run).get('textColor'), '#FF3B16')
        for paragraph in paragraphs[1:4]:
            self.assertEqual(self.para(header, paragraph).find('hh:breakSetting', NS).get('keepWithNext'), '1')
        pic = paragraphs[4].find('hp:run/hp:pic', NS)
        self.assertIsNotNone(pic)
        self.assertEqual(pic.find('hp:pos', NS).get('flowWithText'), '1')
        self.assertEqual(pic.find('hp:pos', NS).get('treatAsChar'), '1')
        self.assertEqual(pic.find('hp:pos', NS).get('vertRelTo'), 'PARA')
        self.assertEqual(section.findall('.//hp:linesegarray', NS), [])
        self.assertEqual(validate_parts(parts), ())

    def test_summary_preserves_mixed_status_colors(self):
        # Catches flattening colored statuses or creating a separate row/paragraph per item.
        summary = SummaryBlock((SummaryItem('첫 지표', '정상', 'blue'),
                                SummaryItem('둘째 지표', '위기', 'crisis'),
                                SummaryItem('셋째 지표', '산출 중', 'ink')))
        parts = self.build(report_document(summary))
        section, header = self.trees(parts)
        table = section.find('.//hp:tbl', NS)
        self.assertEqual((table.get('rowCnt'), table.get('colCnt')), ('1', '1'))
        inner = table.findall('hp:tr/hp:tc/hp:subList/hp:p', NS)
        self.assertEqual(len(inner), 1)
        runs = inner[0].findall('hp:run', NS)
        self.assertEqual([native_text(run.find('hp:t', NS)) for run in runs],
                         ['◇ 첫 지표 ', '(정상)', '  ◇ 둘째 지표 ', '(위기)', '  ◇ 셋째 지표 ', '(산출 중)'])
        self.assertEqual([self.char(header, run).get('textColor') for run in runs],
                         ['#171717', '#0088BF', '#171717', '#FF3B16', '#171717', '#171717'])
        self.assertTrue(all(self.char(header, run).get('height') == '1400' for run in runs))
        self.assertTrue(all(self.char(header, run).find('hh:bold', NS) is not None for run in runs))
        self.assertEqual(table.find('hp:sz', NS).get('width'), '52724')
        self.assertEqual(table.find('hp:tr/hp:tc/hp:cellSz', NS).get('width'), '52724')
        self.assertEqual(table.find('hp:tr/hp:tc', NS).get('hasMargin'), '0')
        fill = header.find('.//hh:borderFill[@id="'+table.get('borderFillIDRef')+'"]', NS)
        self.assertEqual(fill.find('hc:fillBrush/hc:winBrush', NS).get('faceColor'), '#FFFDD4')
        self.assertEqual(section.findall('.//hp:lineBreak', NS), [])

    def test_report_styles_match_existing_print_contract(self):
        # Catches probe style/margin reuse and missing native title/reference borders.
        blocks = [TextBlock('표제','title'), TextBlock('날짜','date'), TextBlock('본문'),
                  TextBlock('산식','formula'), TextBlock('절 제목','heading'), TextBlock('참고','reference-header')]
        parts = self.build(report_document(*blocks))
        section, header = self.trees(parts)
        paragraphs = section.findall('hp:p', NS)
        for p, size, align in zip(paragraphs, ('1800','1200','1300','900','1350','1300'),
                                  ('CENTER','RIGHT','LEFT','LEFT','LEFT','LEFT')):
            with self.subTest(text=native_text(p.find('hp:run/hp:t', NS))):
                self.assertEqual(self.char(header, p.find('hp:run', NS)).get('height'), size)
                prop = self.para(header, p)
                self.assertEqual(prop.find('hh:align', NS).get('horizontal'), align)
                self.assertTrue(all(s.get('type') == 'PERCENT' and s.get('value') == '150'
                                    for s in prop.findall('.//hh:lineSpacing', NS)))
        self.assertTrue(all(f.get('face') == 'Dotum' for f in header.findall('.//hh:font', NS)))
        page = section.find('hp:p/hp:run/hp:secPr/hp:pagePr', NS)
        self.assertEqual((page.get('width'), page.get('height'), page.get('landscape')), ('59528','84189','WIDELY'))
        self.assertEqual(page.find('hp:margin', NS).attrib,
                         dict(header='1417', footer='1417', gutter='0', left='3402', right='3402', top='2835', bottom='2835'))
        for p, sides, color, weight in [(paragraphs[0], ('top','bottom'), '#0088BF', '1.0 mm'),
                                       (paragraphs[-1], ('bottom',), '#528FC6', '0.12 mm')]:
            border_ref = self.para(header, p).find('hh:border', NS).get('borderFillIDRef')
            border = header.find('.//hh:borderFill[@id="'+border_ref+'"]', NS)
            for side in ('left','right','top','bottom'):
                self.assertEqual(border.find('hh:'+side+'Border', NS).get('type'), 'SOLID' if side in sides else 'NONE')
            for side in sides:
                edge = border.find('hh:'+side+'Border', NS)
                self.assertEqual((edge.get('color'), edge.get('width')), (color,weight))
        self.assertEqual(self.char(header, paragraphs[-1].find('hp:run', NS)).get('textColor'), '#0088BF')
        source = ET.fromstring(self.template['Contents/section0.xml'])
        before = copy.deepcopy(source.find('hp:p/hp:run/hp:secPr', NS))
        after = copy.deepcopy(section.find('hp:p/hp:run/hp:secPr', NS))
        before.remove(before.find('hp:pagePr', NS)); after.remove(after.find('hp:pagePr', NS))
        self.assertEqual(ET.tostring(before), ET.tostring(after))
        self.assertEqual(ET.tostring(source.find('hp:p/hp:run/hp:ctrl', NS)), ET.tostring(section.find('hp:p/hp:run/hp:ctrl', NS)))

    def test_native_footer_and_page_breaks(self):
        # Catches footer under secPr, duplicate/static numbering, lost semantic boundaries.
        doc = ReportDocument('2026/08', '2026.10.29', tuple(PageSpec((TextBlock(text),)) for text in ('첫쪽','둘째쪽','셋째쪽')), 'report')
        parts = self.build(doc)
        section, header = self.trees(parts)
        self.assertEqual(len(section.findall('hp:p[@pageBreak="1"]', NS)), 2)
        self.assertEqual(len(section.findall('.//hp:footer', NS)), 1)
        footer = section.find('hp:p/hp:run/hp:ctrl/hp:footer', NS)
        self.assertIsNotNone(footer)
        self.assertEqual(footer.get('applyPageType'), 'BOTH')
        self.assertEqual(footer.find('hp:subList', NS).get('textWidth'), '52724')
        self.assertEqual(footer.find('hp:subList', NS).get('textHeight'), '1417')
        fp = footer.find('hp:subList/hp:p', NS)
        self.assertEqual(self.para(header, fp).find('hh:align', NS).get('horizontal'), 'CENTER')
        self.assertEqual(self.char(header, fp.find('hp:run', NS)).get('height'), '900')
        auto = fp.find('hp:run/hp:ctrl/hp:autoNum', NS)
        self.assertEqual(auto.attrib, {'num':'1', 'numType':'PAGE'})
        self.assertEqual(auto.find('hp:autoNumFormat', NS).get('type'), 'DIGIT')
        page_num = fp.find('hp:run/hp:ctrl/hp:pageNum', NS)
        self.assertEqual(page_num.attrib, {'pos':'BOTTOM_CENTER','formatType':'DIGIT','sideChar':''})
        self.assertEqual(len(section.findall('.//hp:autoNum[@numType="PAGE"]', NS)), 1)
        self.assertEqual(len(section.findall('.//hp:pageNum', NS)), 1)
        self.assertEqual(texts(parts), ['첫쪽','둘째쪽','셋째쪽'])

    def test_basis_empty_is_visible_and_none_is_omitted(self):
        # Catches truthiness filtering the visible construction marker, or printing None.
        for basis, want in [(None, ['○ 지표 0 [정상]','- 설명','* 산식']),
                            ('', ['○ 지표 0 [정상]','- 설명','기준: ','* 산식']),
                            ('기존 기준', ['○ 지표 0 [정상]','- 설명','기준: 기존 기준','* 산식'])]:
            with self.subTest(basis=basis):
                metric = MetricBlock('지표','0','정상','설명',basis,'산식','chart','blue')
                parts = self.build(report_document(metric), {'chart': png(40,10)})
                root, header = self.trees(parts)
                paragraphs = root.findall('hp:p', NS)
                self.assertEqual([''.join(native_text(t) for t in p.findall('hp:run/hp:t', NS)) for p in paragraphs][:-1], want)
                for p in paragraphs[2:-1]:
                    self.assertEqual(self.char(header,p.find('hp:run', NS)).get('height'), '900')

    def test_projected_report_preserves_all_seven_pngs_and_intrinsic_ratios(self):
        # Catches probe dimensions, lost/duplicate chart roles or reordered groups.
        fixture = json.loads((ROOT/'fixtures/report-contract.json').read_text())
        roles = ['recovery','liquidity','construction','funding','cash','referenceRisk','referenceLcr']
        dimensions = [(400,100),(300,90),(100,25),(240,60),(320,80),(600,300),(500,200)]
        assets = {role: png(w,h) for role,(w,h) in zip(roles,dimensions)}
        parts = self.build(project_report(fixture['report']), assets)
        section, _ = self.trees(parts)
        pictures = section.findall('.//hp:pic', NS)
        self.assertEqual([p.find('hc:img',NS).get('binaryItemIDRef') for p in pictures], ['image_'+role for role in roles])
        self.assertEqual(len(section.findall('hp:p[@pageBreak="1"]', NS)), 2)
        for role, picture, (w,h) in zip(roles,pictures,dimensions):
            with self.subTest(role=role):
                size = picture.find('hp:sz',NS)
                self.assertEqual(size.get('width'),'52724')
                self.assertLessEqual(abs(int(size.get('height')) - 52724*h/w), .5)
                self.assertEqual(hashlib.sha256(parts['BinData/'+role+'.png']).digest(), hashlib.sha256(assets[role]).digest())
        self.assertNotIn('숨긴', '\n'.join(texts(parts)))
        self.assertEqual(texts(parts), [
            '합성 <재무> & 위험 보고서', '(2026.10.29, 자금기획팀)', '□ 재무위험지수 종합',
            '◇ 적정 시재 ', '(적정시재 부족)', '  ◇ 건설경기 인식 지수 ', '(정상)',
            '  ◇ 대금 회수 위험 ', '(주의)', '  ◇ 조달위험 인식 지수 ', '(산출 중)',
            '  ◇ 유동성 Gap ', '(정상 순유입)', '□ 위험수준 측정결과',
            '○ 대금 회수 위험 1.00 ', '[주의]', '- 회수율 1.00의 기존 판정을 유지합니다.',
            '* 분양회수 실적 ÷ 분양회수 계획',
            '○ 유동성 Gap — ', '[정상 순유입]', '- 정상 순유입으로 비율을 적용하지 않습니다.',
            '* 기초시재 ÷ (향후 3개월 지출 − 수입)',
            '○ 건설경기 인식 지수 0 ', '[정상]', '- 지수 0도 유효한 표시값입니다.',
            '기준: 2026/07 합성 기준', '* Σ(세부지표 점수 × 가중치)',
            '○ 조달위험 인식 지수 — ', '[산출 중]', '- 조달위험 자료를 조회하고 있습니다.',
            '* 공사채 AAA 1년 금리 − 국고채 1년 금리', '□ 적정시재 산정결과',
            '○ 적정 시재 -17 억원 ', '[적정시재 부족]', '- 현재시재 -17 억원입니다.',
            '* 20% × 분양회수 + 10% × 기타수입',
            '참고', '□ 위험단계 기준', '□ 적정시재 산정방식 (LCR 방식)',
        ])
        self.assertEqual(validate_parts(parts), ())

    def reject(self, doc, assets, message):
        with self.assertRaisesRegex(ValueError, message):
            try:
                build_parts(doc, self.template, assets)
            except TypeError as error:
                self.fail('expected explicit validation: ' + str(error))

    def test_rejects_malformed_png_and_invalid_dimensions(self):
        # Catches signature-only PNG acceptance and incomplete dimension fallback.
        valid = png(40,10)
        bad_pngs = [b'', b'\x89PNG\r\n\x1a\n', valid[:24], png(0,10),
                    valid[:12]+b'NOPE'+valid[16:], valid[:16]+struct.pack('>II',0,10)+valid[24:],
                    valid[:29]+b'bad!'+valid[33:], valid[:33], valid[:-12]]
        for payload in bad_pngs:
            with self.subTest(payload=payload[:24]):
                self.reject(report_document(ImageBlock('chart')), {'chart':payload}, 'PNG')
        for block in [ImageBlock('chart',528,10), ImageBlock('chart',100,None), ImageBlock('chart',None,10)]:
            with self.subTest(block=block):
                self.reject(report_document(block), {'chart':valid}, 'dimensions|exceeds')

    def test_rejects_crc_valid_broken_deflate_or_inexact_scanline_data(self):
        # Catches containers that have valid CRCs but no complete, exact pixel stream.
        cases = [
            ('bad deflate', b'not-a-zlib-stream'),
            ('truncated deflate', zlib.compress(b'\0\0\0\0\xff')[:-1]),
            ('short row', zlib.compress(b'\0\0\0\0')),
            ('long row', zlib.compress(b'\0\0\0\0\xffEXTRA')),
            ('invalid row filter', zlib.compress(b'\5\0\0\0\xff')),
            ('trailing compressed bytes', zlib.compress(b'\0\0\0\0\xff')+b'junk'),
            ('second zlib stream', zlib.compress(b'\0\0\0\0\xff')+zlib.compress(b'next')),
        ]
        for name, compressed in cases:
            with self.subTest(case=name):
                self.reject(report_document(ImageBlock('chart')), {'chart':png_container(compressed=compressed)}, 'PNG')

    def test_rejects_indexed_png_missing_palette_and_invalid_palette_structure(self):
        # Catches required/forbidden/late/duplicate/malformed critical palettes.
        cases = [
            png_container(color=3, compressed=zlib.compress(b'\0\0')),
            png_container(color=2, before_data=((b'PLTE',b'bad!'),)),
            png_container(color=0, before_data=((b'PLTE',b'\0\0\0'),)),
            png_container(color=2, after_data=((b'PLTE',b'\0\0\0'),)),
            png_container(color=2, before_data=((b'PLTE',b'\0\0\0'),(b'PLTE',b'\0\0\0'))),
        ]
        for payload in cases:
            with self.subTest(header=payload[16:29], length=len(payload)):
                self.reject(report_document(ImageBlock('chart')), {'chart':payload}, 'PNG.*PLTE|PLTE.*PNG')

    def test_rejects_unsupported_png_pixel_formats_and_oversized_decode(self):
        # Catches silently accepting layouts the bounded verifier cannot validate.
        cases = [png_container(depth=16), png_container(interlace=1),
                 png_container(color=3, before_data=((b'PLTE',b'\0\0\0'),), compressed=zlib.compress(b'\0\0'))]
        for payload in cases:
            with self.subTest(header=payload[16:29]):
                self.reject(report_document(ImageBlock('chart')), {'chart':payload}, 'unsupported PNG')
        self.reject(report_document(ImageBlock('chart')), {'chart':png_container(100000,100000)}, 'PNG.*limit')

    def test_rejects_unknown_critical_png_chunks(self):
        # Catches silently skipping decoding-critical extensions.
        self.reject(report_document(ImageBlock('chart')),
                    {'chart':png_container(before_data=((b'ABCD',b'unknown'),))}, 'unsupported PNG.*critical')

    def test_rejects_noncontiguous_idat(self):
        # Catches concatenating valid deflate pieces despite an intervening ancillary chunk.
        compressed = zlib.compress(b'\0\0\0\0\xff')
        self.reject(report_document(ImageBlock('chart')),
                    {'chart':png_container(compressed=compressed[:4], after_data=((b'tEXt',b'note\0text'),(b'IDAT',compressed[4:])))},
                    'PNG.*IDAT')

    def test_accepts_all_native_png_filters_and_preserves_bytes(self):
        # Every filter0–4 is reversible for8-bit truecolor samples; no image rewrite is needed.
        for color, samples in [(0,b'\x80'),(2,b'\x10\x20\x30'),(4,b'\x80\xff'),(6,b'\x10\x20\x30\xff')]:
            raw = b''.join(bytes([filter_type])+samples for filter_type in range(5))
            payload = png_container(height=5,color=color,compressed=zlib.compress(raw))
            with self.subTest(color=color):
                parts = self.build(report_document(ImageBlock('chart')), {'chart':payload})
                self.assertEqual(parts['BinData/chart.png'],payload)

    def test_title_borders_preserve_original_padding_inside_blue_rules(self):
        # Original spacing3=12px; 12px×72/96=9pt=900HWPUNIT per block side.
        parts = self.build(report_document(TextBlock('표제','title'),TextBlock('참고','reference-header')))
        section, header = self.trees(parts)
        title, reference = section.findall('hp:p',NS)
        border = self.para(header,title).find('hh:border',NS)
        self.assertEqual((border.get('offsetTop'),border.get('offsetBottom')),('900','900'))
        self.assertEqual((border.get('offsetLeft'),border.get('offsetRight')),('0','0'))
        reference_border = self.para(header,reference).find('hh:border',NS)
        self.assertEqual((reference_border.get('offsetTop'),reference_border.get('offsetBottom')),('0','0'))

    def test_title_reserves_bottom_padding_and_header_gap_before_date(self):
        # A9pt bottom border offset needs flow space plus the parent's8px=6pt gap.
        parts = self.build(report_document(TextBlock('표제','title'),TextBlock('작성일','date')))
        section, header = self.trees(parts)
        title, date = section.findall('hp:p',NS)
        prop = self.para(header,title)
        case = prop.find('hp:switch/hp:case/hh:margin/hc:next',NS)
        default = prop.find('hp:switch/hp:default/hh:margin/hc:next',NS)
        self.assertEqual((case.get('value'),default.get('value')),('1500','3000'))
        self.assertEqual((case.get('unit'),default.get('unit')),('HWPUNIT','HWPUNIT'))
        self.assertEqual(prop.find('hh:border',NS).get('offsetBottom'),'900')
        self.assertEqual(native_text(date.find('hp:run/hp:t',NS)),'작성일')

    def test_rejects_unknown_profile(self):
        # Catches silently falling back to probe defaults for an invalid profile.
        self.reject(ReportDocument('','',(PageSpec((TextBlock('내용'),)),),'unknown'), {}, 'profile')

    def test_rejects_unknown_tones(self):
        # Catches assigning arbitrary or default ink to an unrecognized tone.
        for block in [SummaryBlock((SummaryItem('지표','상태','unknown'),)),
                      MetricBlock('지표','1','상태','설명',None,'산식','chart','unknown')]:
            with self.subTest(block=block):
                self.reject(report_document(block), {'chart':png(40,10)}, 'tone')

    def test_rejects_duplicate_or_missing_metric_images(self):
        # Catches roles referenced twice across metric/standalone images or missing bytes.
        metric = MetricBlock('지표','1','정상','설명',None,'산식','chart')
        self.reject(report_document(metric, ImageBlock('chart')), {'chart':png(40,10)}, 'duplicate')
        self.reject(report_document(metric), {}, 'PNG')

    def test_report_body_typography_is_distinct_from_probe(self):
        # Catches applying the probe's 11pt/160% typography to report paragraphs.
        parts = self.build(report_document(TextBlock('본문')))
        section, header = self.trees(parts)
        paragraph = section.find('hp:p', NS)
        self.assertEqual(self.char(header,paragraph.find('hp:run', NS)).get('height'), '1300')
        self.assertTrue(all(s.get('value') == '150' for s in self.para(header,paragraph).findall('.//hh:lineSpacing', NS)))

    def test_original_three_probe_package_bytes_are_preserved(self):
        # Captured from the untouched serializer before Task4B.
        from generate_sample import make_probe_document
        for mode, want in [('probe-text','09506e780332d4de493dbf6d160fac3db163f7abf42a897366008793334fc0b3'),
                           ('probe-image','5da6bf8be232782b59148d5a9d05accfd6c470d06e0a5bd4ee3f8c33a028f906'),
                           ('probe-table','f9b80e5fb357b807dc89d5c584e1a1968021ebbba83420d477f146d3f67fd7ab')]:
            with self.subTest(mode=mode):
                payload = build_package(build_parts(make_probe_document(mode),self.template,{'chart':PNG}))
                self.assertEqual(hashlib.sha256(payload).hexdigest(),want)


if __name__ == '__main__':
    unittest.main()
