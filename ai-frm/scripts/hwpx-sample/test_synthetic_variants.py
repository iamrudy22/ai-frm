"""Stage 5 synthetic QA inputs and real exported XML, without financial calculation."""
import copy
import importlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

import package_io
import test_generate_sample as cli_contract

ROOT = Path(__file__).parent.resolve()
CONTRACT = json.loads((ROOT / 'fixtures/report-contract.json').read_text(encoding='utf-8'))


class SyntheticVariantsContract(unittest.TestCase):
    def variants(self, report=None):
        # A missing fixture utility is an explicit failed public contract, not an import error.
        self.assertIsNotNone(importlib.util.find_spec('synthetic_variants'),
                             'stage 5 reusable synthetic variant generator is missing')
        return importlib.import_module('synthetic_variants').build_variants(
            copy.deepcopy(CONTRACT['report']) if report is None else report)

    def test_baseline_preserves_every_saved_field_and_variants_are_detached(self):
        report = copy.deepcopy(CONTRACT['report'])
        report['futureDisplayField'] = {'nested': ['보존할 합성 표시값']}
        before = copy.deepcopy(report)
        variants = self.variants({'json': report, 'wrapperOnly': '저장 메타데이터'})
        self.assertEqual(set(variants), {'baseline', 'year-end', 'year-start',
                         'zero-negative-netinflow', 'partial-unavailable', 'all-unavailable', 'one-point'})
        self.assertEqual(report, before)
        self.assertEqual(variants['baseline'], report)
        variants['year-end']['metrics'][0]['points'][0]['value'] = 12345
        variants['year-start']['futureDisplayField']['nested'].append('수정')
        self.assertEqual(variants['baseline'], before)
        self.assertEqual(report, before)
        self.assertEqual(self.variants(report)['year-end']['metrics'][0]['points'][0]['value'], 1.00)

    def test_year_transition_has_valid_eighteen_month_chart_payloads_and_long_labels(self):
        variants = self.variants()
        for name, end, start in [('year-end', '2026/12', '2025/07'),
                                 ('year-start', '2027/01', '2025/08')]:
            report = variants[name]
            with self.subTest(name=name):
                self.assertEqual(report['reportMonth'], end)
                self.assertEqual(report['latestRound'], end)
                self.assertIn(end, report['title'])
                for metric in report['metrics']:
                    self.assertEqual(len(metric['points']), 18)
                    self.assertEqual(metric['points'][0]['month'], start)
                    self.assertEqual(metric['points'][-1]['month'], end)
                    self.assertEqual(len({p['month'] for p in metric['points']}), 18)
                    self.assertGreater(len(metric['title']), 20)
                    self.assertEqual(metric['formula'], next(m['formula'] for m in CONTRACT['report']['metrics'] if m['id'] == metric['id']))
        self.assertIn('2026/12', [p['month'] for p in variants['year-start']['metrics'][0]['points']])

    def test_boundary_values_and_missing_states_are_explicit_saved_display_values(self):
        variants = self.variants()
        metrics = {m['id']: m for m in variants['zero-negative-netinflow']['metrics']}
        self.assertEqual((metrics['recovery']['value'], metrics['construction']['value']), ('0.00', '0'))
        self.assertEqual(metrics['funding']['value'], '-0.125%p')
        self.assertEqual((metrics['liquidity']['value'], metrics['liquidity']['status']), ('—', '정상 순유입'))
        self.assertEqual(metrics['cash']['value'], '-17 억원')
        self.assertTrue(all(p['kind'] == 'not-applicable' for p in metrics['liquidity']['points']))
        partial = {m['id']: m for m in variants['partial-unavailable']['metrics']}
        self.assertEqual((partial['recovery']['status'], partial['funding']['status']), ('산출 불가', '산출 중'))
        self.assertIn('👩\u200d💻', partial['recovery']['narrative'])
        self.assertIn('<검증> &', partial['recovery']['narrative'])
        self.assertGreater(len(partial['recovery']['narrative']), 60)
        self.assertTrue(all(m['status'] == '산출 불가' and m['points'] == []
                            for m in variants['all-unavailable']['metrics']))
        self.assertTrue(all(len(m['points']) == 1 and m['points'][0]['kind'] == 'available'
                            for m in variants['one-point']['metrics']))

    def test_chart_history_coverage_matches_points_and_cash_has_secondary_values(self):
        for name, report in self.variants().items():
            for metric in report['metrics']:
                with self.subTest(name=name, metric=metric['id']):
                    points, coverage = metric['points'], metric['historyCoverage']
                    self.assertIsInstance(metric['historyNote'], str)
                    self.assertEqual(coverage['totalMonths'], len(points))
                    self.assertEqual((coverage['from'], coverage['to']),
                                     (points[0]['month'], points[-1]['month']) if points else (None, None))
                    for kind, field in [('available', 'availableMonths'), ('missing', 'missingMonths'),
                                        ('not-applicable', 'notApplicableMonths')]:
                        self.assertEqual(coverage[field], [p['month'] for p in points if p['kind'] == kind])
                    count = len(coverage['availableMonths'])
                    self.assertEqual(coverage['kind'], 'empty' if count == 0 else 'single' if count == 1 else 'multiple')
                    if metric['id'] == 'cash':
                        self.assertTrue(all(isinstance(p['secondary'], (float, int))
                                            for p in points if p['kind'] == 'available'))

    def test_emitted_raw_json_exports_exact_body_order_unicode_and_role_references(self):
        variants = self.variants()
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            assets = {role: cli_contract.png(index * 30) for index, role in enumerate(cli_contract.ROLES)}
            paths = {}
            for role, payload in assets.items():
                path = folder / (role + '.png')
                path.write_bytes(payload)
                paths[role] = str(path)
            manifest = folder / 'assets.json'
            manifest.write_text(json.dumps(paths), encoding='utf-8')
            for name, report in variants.items():
                with self.subTest(name=name):
                    path, output = folder / (name + '.json'), folder / (name + '.hwpx')
                    path.write_text(json.dumps(report, ensure_ascii=False), encoding='utf-8')
                    before = path.read_bytes()
                    result = subprocess.run([sys.executable, str(ROOT / 'generate_sample.py'),
                        '--mode', 'report', '--report', str(path), '--assets', str(manifest),
                        '--output', str(output)], capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(path.read_bytes(), before)
                    parts = package_io.read_package(output.read_bytes())
                    self.assertEqual(package_io.validate_parts(parts), ())
                    section = ET.fromstring(parts['Contents/section0.xml'])
                    paragraphs = [''.join(''.join(t.itertext()) for t in p.findall('.//hp:t', cli_contract.NS))
                                  for p in section.findall('hp:p', cli_contract.NS)]
                    by_id = {m['id']: m for m in report['metrics']}
                    expected_heads = ['○ ' + by_id[r]['title'] + ' ' + by_id[r]['value']
                                      + ' [' + by_id[r]['status'] + ']' for r in cli_contract.ROLES[:5]]
                    self.assertEqual([p for p in paragraphs if p.startswith('○ ')], expected_heads)
                    summary = '  '.join('◇ ' + m['title'] + ' (' + m['status'] + ')' for m in report['metrics'])
                    self.assertIn(summary, paragraphs)
                    for metric in report['metrics']:
                        reason = metric['narrative']
                        if metric['status'] in ('산출 불가', '산출 중') and len(reason) > 60:
                            # Explicit fixture boundary: 58 가, emoji, then overflowing tail.
                            reason = '가' * 58 + '😀… (상세는 HTML 참고)'
                        self.assertIn('- ' + reason, paragraphs)
                        self.assertIn('* ' + metric['formula'], paragraphs)
                    self.assertIn('기준: ' + by_id['construction']['basis'], paragraphs)
                    self.assertEqual([i.get('binaryItemIDRef') for i in section.findall('.//hc:img', cli_contract.NS)],
                                     ['image_' + r for r in cli_contract.ROLES])
                    for role, payload in assets.items():
                        self.assertEqual(parts['BinData/' + role + '.png'], payload)
                    if name == 'partial-unavailable':
                        self.assertIn('😀', parts['Contents/section0.xml'].decode())
                        self.assertNotIn('👩\u200d💻', parts['Contents/section0.xml'].decode())
                    if name in ('year-end', 'year-start'):
                        self.assertIn('&lt;긴 제목&gt; &amp;', parts['Contents/section0.xml'].decode())

    def test_pure_factory_needs_no_file_access_and_keeps_source_unchanged(self):
        report = copy.deepcopy(CONTRACT['report'])
        before = copy.deepcopy(report)
        # File validation/persistence belongs to the existing report CLI.
        # Any accidental read or write in the pure factory fails immediately.
        factory = self.variants  # Import happens before blocking file access.
        factory(report)
        with patch('builtins.open', side_effect=AssertionError('unexpected file I/O')), \
             patch.object(Path, 'open', side_effect=AssertionError('unexpected Path I/O')):
            variants = factory({'json': report})
        self.assertEqual(variants['baseline'], before)
        self.assertEqual(report, before)
        variants['partial-unavailable']['metrics'][0]['title'] = 'detached'
        self.assertEqual(variants['baseline'], before)
        self.assertEqual(report, before)


if __name__ == '__main__':
    unittest.main()
