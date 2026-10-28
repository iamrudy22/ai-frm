"""CLI boundary contracts for saved display data and native-flow HWPX output."""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET
import zipfile
import zlib

ROOT = Path(__file__).parent.resolve()
SPEC = importlib.util.spec_from_file_location('generate_sample', ROOT / 'generate_sample.py')
writer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(writer)
NS = {'hp': 'http://www.hancom.co.kr/hwpml/2011/paragraph',
      'hc': 'http://www.hancom.co.kr/hwpml/2011/core',
      'hh': 'http://www.hancom.co.kr/hwpml/2011/head',
      'opf': 'http://www.idpf.org/2007/opf/'}
ROLES = ['recovery', 'liquidity', 'construction', 'funding', 'cash', 'referenceRisk', 'referenceLcr']
# Accepted probe containers stay byte-stable, even though report fixtures must be fully valid.
PROBE_PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082')
EXPECTED_PAGES = [
    ['합성 <재무> & 위험 보고서', '(2026.10.29, 자금기획팀)', '□ 재무위험지수 종합',
     '◇ 적정 시재 (적정시재 부족)  ◇ 건설경기 인식 지수 (정상)  ◇ 대금 회수 위험 (주의)  ◇ 조달위험 인식 지수 (산출 중)  ◇ 유동성 Gap (정상 순유입)',
     '□ 위험수준 측정결과', '○ 대금 회수 위험 1.00 [주의]', '- 회수율 1.00의 기존 판정을 유지합니다.',
     '* 분양회수 실적 ÷ 분양회수 계획', '○ 유동성 Gap — [정상 순유입]', '- 정상 순유입으로 비율을 적용하지 않습니다.',
     '* 기초시재 ÷ (향후 3개월 지출 − 수입)'],
    ['○ 건설경기 인식 지수 0 [정상]', '- 지수 0도 유효한 표시값입니다.', '기준: 2026/07 합성 기준',
     '* Σ(세부지표 점수 × 가중치)', '○ 조달위험 인식 지수 — [산출 중]', '- 조달위험 자료를 조회하고 있습니다.',
     '* 공사채 AAA 1년 금리 − 국고채 1년 금리', '□ 적정시재 산정결과', '○ 적정 시재 -17 억원 [적정시재 부족]',
     '- 현재시재 -17 억원입니다.', '* 20% × 분양회수 + 10% × 기타수입'],
    ['참고', '□ 위험단계 기준', '□ 적정시재 산정방식 (LCR 방식)'],
]


def png(color):
    """Different valid RGBA images make swapped/duplicated role bytes observable."""
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 2, 1, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b'\0' + bytes([color, 20, 40, 255]) * 2)) + chunk(b'IEND', b''))


class SampleContract(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.report = json.loads((ROOT / 'fixtures/report-contract.json').read_text())['report']
        self.report_path = self.folder / 'report.json'
        self.assets_path = self.folder / 'assets.json'
        self.output = self.folder / 'sample.hwpx'
        self.paths = {}
        image_dir = self.folder / 'images'
        image_dir.mkdir()
        for index, role in enumerate(ROLES):
            image = image_dir / (role + '.png')
            image.write_bytes(png(index * 30))
            self.paths[role] = str(image.relative_to(self.folder))
        self.save_inputs()

    def save_inputs(self, report=None, assets=None):
        self.report_path.write_text(json.dumps(self.report if report is None else report, ensure_ascii=False))
        self.assets_path.write_text(json.dumps(self.paths if assets is None else assets))

    def args(self, output=None):
        return ['--mode', 'report', '--report', str(self.report_path), '--assets', str(self.assets_path),
                '--output', str(output or self.output)]

    def run_cli(self, args=None):
        return subprocess.run([sys.executable, str(ROOT / 'generate_sample.py'), *(self.args() if args is None else args)],
                              cwd=self.folder.parent, capture_output=True, text=True)

    def assert_success(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def assert_failure_preserves_files(self, marker=None):
        # Catches write-before-validation and truncating an existing accepted destination.
        sources = [self.report_path, self.assets_path, *(self.folder / path for path in self.paths.values())]
        before = {path: path.read_bytes() for path in sources if path.is_file()}
        for existing in (False, True):
            if existing:
                self.output.write_bytes(b'accepted existing output')
            else:
                self.output.unlink(missing_ok=True)
            result = self.run_cli()
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, '')
            if marker:
                self.assertIn(marker, result.stderr)
            if existing:
                self.assertEqual(self.output.read_bytes(), b'accepted existing output')
            else:
                self.assertFalse(self.output.exists())
            self.assertEqual(list(self.folder.glob('.sample.hwpx-*.tmp')), [])
            self.assertEqual({path: path.read_bytes() for path in before}, before)

    def test_report_without_layout_preserves_exact_page_content_and_seven_role_assets(self):
        # Catches the legacy layout gate, summary/body reordering, hidden text leaks or image-role loss.
        before = self.report_path.read_bytes()
        status = self.assert_success(self.run_cli())
        self.assertEqual(self.report_path.read_bytes(), before)
        self.assertEqual(status['mode'], 'report')
        self.assertEqual(status['declaredPageLayouts'], 3)
        self.assertEqual(status['declaredPageBreaks'], 2)
        self.assertEqual(status['imageRoles'], ROLES)
        self.assertEqual(status['images'], 7)
        self.assertEqual(status['sha256'], hashlib.sha256(self.output.read_bytes()).hexdigest())
        self.assertEqual(status['mybox'], 'not_run')
        self.assertNotIn('renderedPages', status)
        with zipfile.ZipFile(self.output) as archive:
            self.assertEqual(archive.infolist()[0].filename, 'mimetype')
            self.assertEqual(archive.infolist()[0].compress_type, zipfile.ZIP_STORED)
            self.assertEqual(archive.read('mimetype'), b'application/hwp+zip')
            section = ET.fromstring(archive.read('Contents/section0.xml'))
            pages = [[]]
            for paragraph in section.findall('hp:p', NS):
                if paragraph.get('pageBreak') == '1':
                    pages.append([])
                text = ''.join(''.join(t.itertext()) for t in paragraph.findall('.//hp:t', NS))
                if text:
                    pages[-1].append(text)
            self.assertEqual(pages, EXPECTED_PAGES)
            self.assertEqual(section.findall('.//hp:linesegarray', NS), [])
            self.assertEqual([p.find('hc:img', NS).get('binaryItemIDRef')
                              for p in section.findall('.//hp:pic', NS)], ['image_' + role for role in ROLES])
            self.assertEqual(len(section.findall('.//hp:autoNum[@numType="PAGE"]', NS)), 1)
            self.assertEqual(len(section.findall('.//hp:footer', NS)), 1)
            for role, path in self.paths.items():
                self.assertEqual(archive.read('BinData/' + role + '.png'), (self.folder / path).read_bytes())
            manifest = ET.fromstring(archive.read('Contents/content.hpf'))
            declared = {item.get('id') for item in manifest.findall('.//opf:item', NS)}
            for item in manifest.findall('.//opf:item', NS):
                self.assertIn(item.get('href'), archive.namelist())
            for image in section.findall('.//hc:img', NS):
                self.assertIn(image.get('binaryItemIDRef'), declared)
            header = ET.fromstring(archive.read('Contents/header.xml'))
            chars = {p.get('id') for p in header.findall('.//hh:charPr', NS)}
            paras = {p.get('id') for p in header.findall('.//hh:paraPr', NS)}
            for paragraph in section.findall('.//hp:p', NS):
                self.assertIn(paragraph.get('paraPrIDRef'), paras)
            for run in section.findall('.//hp:run', NS):
                self.assertIn(run.get('charPrIDRef'), chars)
            self.assertIn('&lt;재무&gt; &amp;', archive.read('Contents/section0.xml').decode())
            self.assertNotIn('숨긴', archive.read('Preview/PrvText.txt').decode())

    def test_raw_and_wrapper_json_produce_identical_deterministic_bytes(self):
        # Catches wrapper removal, path-dependent ZIP bytes or repeated-run drift.
        self.assert_success(self.run_cli())
        raw = self.output.read_bytes()
        self.save_inputs(report={'json': self.report, 'ignored': 'wrapper metadata'})
        self.assert_success(self.run_cli())
        self.assertEqual(self.output.read_bytes(), raw)
        self.assert_success(self.run_cli())
        self.assertEqual(self.output.read_bytes(), raw)

    def test_removed_layout_flag_is_a_clear_cli_error(self):
        # Catches silently accepting or retaining coordinate-layout fallback.
        result = self.run_cli(self.args() + ['--layout', str(self.folder / 'legacy.json')])
        self.assertEqual(result.returncode, 2)
        self.assertIn('unrecognized arguments: --layout', result.stderr)
        self.assertFalse(self.output.exists())

    def test_report_requires_report_and_assets(self):
        # Catches allowing incomplete report mode or silently substituting probe assets.
        for missing in ('--report', '--assets'):
            args = self.args()
            index = args.index(missing)
            del args[index:index + 2]
            result = self.run_cli(args)
            self.assertEqual(result.returncode, 2)
            self.assertIn(missing, result.stderr)
            self.assertFalse(self.output.exists())

    def test_duplicate_missing_and_foreign_metric_ids_fail_without_output(self):
        # Catches silently overwriting duplicate metrics or printing an incomplete set.
        metrics = copy.deepcopy(self.report['metrics'])
        for replacement in (metrics[:-1], metrics[:-1] + [metrics[0]], metrics + [metrics[0]],
                            metrics[:-1] + [{**metrics[-1], 'id': 'unknown'}]):
            with self.subTest(ids=[metric['id'] for metric in replacement]):
                self.report['metrics'] = replacement
                self.save_inputs()
                self.assert_failure_preserves_files('metric')

    def test_malformed_report_shapes_fail_without_output(self):
        # Catches coercing malformed display DTO fields to apparently valid text or statuses.
        invalid = [[], None, {'json': []}, {**self.report, 'isTemplate': True},
                   {**self.report, 'metrics': None}, {**self.report, 'title': 0},
                   {**self.report, 'reportMonth': None}, {**self.report, 'generatedOn': False}]
        for field, value in [('id', []), ('title', None), ('value', 0), ('status', 0), ('narrative', []),
                             ('formula', None), ('basis', 0), ('grade', [])]:
            report = copy.deepcopy(self.report)
            report['metrics'][1][field] = value
            invalid.append(report)
        for payload in invalid:
            with self.subTest(report=payload):
                self.save_inputs(report=payload) if payload is not None else self.report_path.write_text('null')
                self.assert_failure_preserves_files('report')
        report = copy.deepcopy(self.report)
        del report['metrics'][0]['formula']
        self.save_inputs(report=report)
        self.assert_failure_preserves_files('report')

    def test_invalid_json_and_duplicate_image_roles_fail_without_output(self):
        # Catches JSON overwrite of duplicate image role keys and parse-after-write errors.
        for path, payload in [(self.report_path, '{'), (self.assets_path, '['),
                              (self.assets_path, self.assets_path.read_text()[:-1] + ',"cash":"images/cash.png"}')]:
            with self.subTest(path=path.name, payload=payload[:20]):
                self.save_inputs()
                path.write_text(payload)
                self.assert_failure_preserves_files()

    def test_missing_extra_or_malformed_asset_roles_fail_without_output(self):
        # Catches ignored extra roles, missing reference images and non-path asset values.
        invalid = [[], None, {role: path for role, path in self.paths.items() if role != 'cash'},
                   {**self.paths, 'chart': self.paths['cash']}, {**self.paths, 'cash': 12},
                   {**self.paths, 'cash': ''}, {**self.paths, 'cash': 'missing.png'},
                   {**self.paths, 'cash': 'images'}]
        for assets in invalid:
            with self.subTest(assets=assets):
                self.save_inputs(assets=assets) if assets is not None else self.assets_path.write_text('null')
                self.assert_failure_preserves_files()

    def test_corrupt_png_is_rejected_without_touching_destination(self):
        # Catches signature-only image acceptance or writing before the serializer validates CRC/pixels.
        cash = self.folder / self.paths['cash']
        for payload in (b'', b'\x89PNG\r\n\x1a\n', png(1)[:-12], PROBE_PNG):
            with self.subTest(length=len(payload)):
                cash.write_bytes(payload)
                self.assert_failure_preserves_files('PNG')

    def test_output_cannot_alias_any_report_source_via_direct_symlink_or_hardlink(self):
        # Catches destroying reports, manifests, templates or source PNGs through any alias form.
        template = self.folder / 'blank.hwpx'
        template.write_bytes((ROOT / 'blank.hwpx').read_bytes())
        provenance = self.folder / 'template-provenance.json'
        provenance.write_bytes((ROOT / 'template-provenance.json').read_bytes())
        sources = [self.report_path, self.assets_path, template, provenance,
                   *(self.folder / path for path in self.paths.values())]
        for source in sources:
            for kind in ('direct', 'symlink', 'hardlink'):
                with self.subTest(source=source.name, kind=kind):
                    alias = self.folder / 'alias.hwpx'
                    alias.unlink(missing_ok=True)
                    if kind == 'symlink':
                        alias.symlink_to(source)
                    elif kind == 'hardlink':
                        alias.hardlink_to(source)
                    destination = source if kind == 'direct' else alias
                    before = source.read_bytes()
                    with patch.object(writer, 'ROOT', self.folder), patch('sys.argv', ['generate_sample', *self.args(destination)]):
                        with self.assertRaisesRegex(ValueError, 'output.*input'):
                            writer.main()
                    self.assertEqual(source.read_bytes(), before)

    def test_template_failure_preserves_existing_destination(self):
        # Catches bypassing template provenance and writing partial packages on template errors.
        (self.folder / 'blank.hwpx').write_bytes(b'broken template')
        (self.folder / 'template-provenance.json').write_bytes((ROOT / 'template-provenance.json').read_bytes())
        self.output.write_bytes(b'accepted')
        with patch.object(writer, 'ROOT', self.folder), patch('sys.argv', ['generate_sample', *self.args()]):
            with self.assertRaisesRegex(ValueError, 'blank package changed'):
                writer.main()
        self.assertEqual(self.output.read_bytes(), b'accepted')

    def test_replace_failure_preserves_destination_and_cleans_temporary_file(self):
        # A filesystem failure is injected only at the final replace; the real pipeline still runs.
        self.output.write_bytes(b'accepted')
        before = {path: path.read_bytes() for path in [self.report_path, self.assets_path,
                                                      *(self.folder / value for value in self.paths.values())]}
        with patch('package_io.os.replace', side_effect=OSError('replace denied')), \
             patch('sys.argv', ['generate_sample', *self.args()]), patch('sys.stdout', new_callable=io.StringIO) as stdout:
            with self.assertRaisesRegex(OSError, 'replace denied'):
                writer.main()
        self.assertEqual(stdout.getvalue(), '')
        self.assertEqual(self.output.read_bytes(), b'accepted')
        self.assertEqual({path: path.read_bytes() for path in before}, before)
        self.assertEqual(list(self.folder.glob('.sample.hwpx-*.tmp')), [])

    def test_short_reason_uses_existing_codepoint_rule(self):
        # Catches CLI display rewrites diverging from the saved print reason policy.
        self.report['metrics'][2].update(status='산출 불가', narrative='가' * 58 + '😀나다')
        self.save_inputs()
        self.assert_success(self.run_cli())
        with zipfile.ZipFile(self.output) as archive:
            text = ''.join(ET.fromstring(archive.read('Contents/section0.xml')).itertext())
        self.assertIn('- ' + '가' * 58 + '😀… (상세는 HTML 참고)', text)
        self.assertNotIn('😀나다', text)

    def test_probe_modes_keep_accepted_payload_bytes_and_native_flow(self):
        # Catches unrelated probe serialization drift while replacing report CLI plumbing.
        chart = self.folder / 'chart.png'
        chart.write_bytes(PROBE_PNG)
        assets = self.folder / 'probe-assets.json'
        assets.write_text(json.dumps({'chart': 'chart.png'}))
        hashes = [('probe-text', 0, 0, '09506e780332d4de493dbf6d160fac3db163f7abf42a897366008793334fc0b3'),
                  ('probe-image', 1, 0, '5da6bf8be232782b59148d5a9d05accfd6c470d06e0a5bd4ee3f8c33a028f906'),
                  ('probe-table', 1, 1, 'f9b80e5fb357b807dc89d5c584e1a1968021ebbba83420d477f146d3f67fd7ab')]
        for mode, images, tables, digest in hashes:
            with self.subTest(mode=mode):
                args = ['--mode', mode, '--output', str(self.output)]
                if images:
                    args += ['--assets', str(assets)]
                self.assert_success(self.run_cli(args))
                self.assertEqual(hashlib.sha256(self.output.read_bytes()).hexdigest(), digest)
                with zipfile.ZipFile(self.output) as archive:
                    section = ET.fromstring(archive.read('Contents/section0.xml'))
                    self.assertEqual(len(section.findall('.//hp:pic', NS)), images)
                    self.assertEqual(len(section.findall('.//hp:tbl', NS)), tables)
                    self.assertEqual(section.findall('.//hp:linesegarray', NS), [])
                    self.assertIn('× ÷ − Σ', ''.join(section.itertext()))
                    if images:
                        self.assertEqual(archive.read('BinData/chart.png'), PROBE_PNG)
        before = assets.read_bytes()
        result = self.run_cli(['--mode', 'probe-image', '--assets', str(assets), '--output', str(assets)])
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(assets.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
