"""Saved display DTO → immutable print values; expectations are hand-derived."""
import copy
from dataclasses import FrozenInstanceError, asdict
import json
from pathlib import Path
import unittest

import report_projection as projection


CONTRACT = json.loads((Path(__file__).parent / 'fixtures/report-contract.json').read_text())


class ReportProjectionContract(unittest.TestCase):
    def setUp(self):
        self.report = copy.deepcopy(CONTRACT['report'])
        self.expected = CONTRACT['expected']

    def project(self):
        # Missing public contract must be an assertion failure, not an import error.
        project = getattr(projection, 'project_report', None)
        self.assertTrue(callable(project), 'project_report contract is not implemented')
        return project(self.report)

    def metric_blocks(self, document):
        return [block for page in document.pages for block in page.blocks
                if isinstance(block, projection.MetricBlock)]

    def test_projection_preserves_display_strings_and_input(self):
        # Catches coercion/reformatting (1.00/0/negative/—), status replacement or mutation.
        before = copy.deepcopy(self.report)
        document = self.project()
        self.assertEqual(document.report_month, self.expected['reportMonth'])
        self.assertEqual(document.generated_on, self.expected['generatedOn'])
        self.assertEqual([[asdict(block) for block in page.blocks
                           if isinstance(block, projection.MetricBlock)]
                          for page in document.pages], self.expected['metricPages'])
        self.assertEqual([[asdict(block) for block in page.blocks
                           if isinstance(block, projection.TextBlock)]
                          for page in document.pages], self.expected['textPages'])
        self.assertEqual(self.report, before)
        self.assertEqual(self.project(), document)

    def test_projection_rejects_duplicate_or_missing_metric(self):
        # Catches a dict overwrite silently accepting duplicate, missing or foreign IDs.
        original = copy.deepcopy(self.report['metrics'])
        bad_sets = [original[:-1], original + [original[0]],
                    original[:-1] + [original[0]],
                    original[:-1] + [{**original[-1], 'id': 'unknown'}]]
        for metrics in bad_sets:
            with self.subTest(ids=[metric['id'] for metric in metrics]):
                self.report['metrics'] = metrics
                with self.assertRaisesRegex(ValueError, 'metric'):
                    self.project()

    def test_projection_preserves_summary_order_and_fixed_body_order(self):
        # Catches sorting input summary or iterating body in supplied metric order.
        document = self.project()
        summary = document.pages[0].blocks[3]
        self.assertIsInstance(summary, projection.SummaryBlock)
        self.assertEqual([asdict(item) for item in summary.items], self.expected['summary'])
        self.assertEqual([[block.image_role for block in page.blocks
                           if isinstance(block, projection.MetricBlock)]
                          for page in document.pages],
                         [['recovery', 'liquidity'], ['construction', 'funding', 'cash'], []])
        self.assertEqual([type(block) for block in document.pages[1].blocks],
                         [projection.MetricBlock, projection.MetricBlock,
                          projection.TextBlock, projection.MetricBlock])

    def test_failure_reason_matches_print_codepoint_boundaries(self):
        # Catches UTF-16/grapheme counting, off-by-one slicing, or shortening all narratives.
        cases = [
            ('59', '가' * 59, '가' * 59),
            ('60', '가' * 60, '가' * 60),
            ('61', '가' * 61, '가' * 59 + '… (상세는 HTML 참고)'),
            ('emoji60', '가' * 59 + '😀', '가' * 59 + '😀'),
            ('emoji61', '가' * 58 + '😀나다', '가' * 58 + '😀… (상세는 HTML 참고)'),
            ('combining60', '가' * 58 + 'e\u0301', '가' * 58 + 'e\u0301'),
            ('combining61', '가' * 58 + 'e\u0301끝', '가' * 58 + 'e… (상세는 HTML 참고)'),
            ('zwj60', '가' * 57 + '👩\u200d💻', '가' * 57 + '👩\u200d💻'),
            ('zwj61', '가' * 58 + '👩\u200d💻', '가' * 58 + '👩… (상세는 HTML 참고)'),
        ]
        target = self.report['metrics'][2]
        for status in ('산출 불가', '산출 중'):
            for name, reason, want in cases:
                with self.subTest(status=status, boundary=name):
                    target.update(status=status, narrative=reason)
                    self.assertEqual(self.metric_blocks(self.project())[0].narrative, want)
                    self.assertEqual(target['narrative'], reason)

    def test_projection_keeps_long_ordinary_narratives(self):
        # Catches applying the print failure abbreviation to normal/net-inflow descriptions.
        reason = '정상 순유입 안내를 그대로 보존합니다. ' * 5
        for status in ('정상', '정상 순유입', '산출 전', '산출 불가 '):
            with self.subTest(status=status):
                self.report['metrics'][2].update(status=status, narrative=reason)
                self.assertEqual(self.metric_blocks(self.project())[0].narrative, reason)

    def test_projection_excludes_non_print_details(self):
        # Catches leaking hidden basis/source/history/warnings/round text to print values.
        document = self.project()
        metrics = self.metric_blocks(document)
        self.assertEqual([block.basis for block in metrics], [None, None, '2026/07 합성 기준', None, None])
        self.assertNotIn('숨긴', json.dumps(asdict(document), ensure_ascii=False))
        roles = [block.image_role if isinstance(block, projection.MetricBlock) else block.role
                 for page in document.pages for block in page.blocks
                 if isinstance(block, (projection.MetricBlock, projection.ImageBlock))]
        self.assertEqual(roles, self.expected['imageRoles'])
        self.assertEqual([(block.width_pt, block.height_pt)
                          for block in document.pages[2].blocks
                          if isinstance(block, projection.ImageBlock)], [(None, None), (None, None)])

    def test_projection_uses_saved_display_tones_without_numeric_judgment(self):
        # Catches status-text-only colors, financial rejudgment, or changed branch precedence.
        cases = [(None, '정상', 'ink'), (None, '위기', 'ink'),
                 (None, '적정시재 부족', 'crisis'), ('정상', '적정시재 부족', 'blue'),
                 ('주의', '정상', 'crisis'), ('경고', '산출 중', 'crisis'),
                 ('위기', '정상 순유입', 'crisis')]
        for grade, status, tone in cases:
            with self.subTest(grade=grade, status=status):
                self.report['metrics'][2].update(grade=grade, status=status, value='999999.00')
                document = self.project()
                self.assertEqual(self.metric_blocks(document)[0].tone, tone)
                self.assertEqual(document.pages[0].blocks[3].items[2].tone, tone)

    def test_projected_document_detaches_immutable_summary_from_input(self):
        # Catches retaining mutable input arrays or mutable summary items in the output.
        document = self.project()
        summary = document.pages[0].blocks[3]
        with self.assertRaises(FrozenInstanceError):
            summary.items[0].status = '수정'
        with self.assertRaises(FrozenInstanceError):
            summary.items = ()
        self.assertIsInstance(summary.items, tuple)
        self.assertIsInstance(document.pages, tuple)
        self.assertTrue(all(isinstance(page.blocks, tuple) for page in document.pages))
        self.report['metrics'][0]['status'] = '수정'
        self.report['metrics'].reverse()
        self.assertEqual([asdict(item) for item in summary.items], self.expected['summary'])
        self.assertEqual(projection.SummaryBlock(list(summary.items)).items, summary.items)

    def test_projection_selects_report_styles_and_keeps_probe_default(self):
        # Catches applying probe typography/page margins to the full report.
        document = self.project()
        self.assertEqual(getattr(document, 'style_profile', None), self.expected['styleProfile'])
        probe = projection.ReportDocument('2026/08', '2026.10.29', ())
        self.assertEqual(probe.style_profile, 'probe')
        with self.assertRaises(FrozenInstanceError):
            document.style_profile = 'probe'

    def test_projection_preserves_reference_header_presentation_role(self):
        # Catches losing the blue reference label and its bottom border as a generic heading.
        header = self.project().pages[2].blocks[0]
        self.assertEqual((header.text, header.style), ('참고', 'reference-header'))

    def test_projection_distinguishes_empty_construction_basis_from_omission(self):
        # Catches hiding construction's visible '기준: ' when its saved basis is empty.
        self.report['metrics'][1]['basis'] = ''
        metrics = self.metric_blocks(self.project())
        self.assertEqual(metrics[2].basis, '')
        for index in (0, 1, 3, 4):
            with self.subTest(image_role=metrics[index].image_role):
                self.assertIsNone(metrics[index].basis)


if __name__ == '__main__':
    unittest.main()
