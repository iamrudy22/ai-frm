"""Serialize saved FinancialReport display data or compatibility probes to HWPX.

Report mode consumes a raw report or {"json": report} wrapper and seven existing
PNG assets. Native-flow projection/XML/package modules own document content;
this boundary only reads, validates source shapes and writes atomically.
Skeleton: python-hwpx 6.10.0, Apache-2.0 (template-provenance.json).
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from document_xml import build_parts
from package_io import read_package, build_package, write_atomic
from report_projection import METRIC_IDS, project_report

ROOT = Path(__file__).parent
REPORT_IMAGE_ROLES = (*METRIC_IDS, 'referenceRisk', 'referenceLcr')


def ensure_output_is_separate(output, inputs):
    """Only the file-reading boundary knows all input paths."""
    output = Path(output)
    for source in map(Path, inputs):
        if output.resolve() == source.resolve() or (output.exists() and source.exists() and output.samefile(source)):
            raise ValueError('output must not overwrite an input file: ' + str(source))


def read_json(path):
    """Reject duplicate keys instead of silently dropping a metric/image role."""
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate JSON key: ' + key)
            result[key] = value
        return result
    return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique_object)


def read_report(path):
    report = read_json(path)
    if isinstance(report, dict) and 'json' in report:
        report = report['json']
    if not isinstance(report, dict) or report.get('isTemplate') is not False:
        raise ValueError('report must be a calculated FinancialReport object')
    for field in ('title', 'reportMonth', 'generatedOn'):
        if not isinstance(report.get(field), str):
            raise ValueError('report ' + field + ' must be a display string')
    metrics = report.get('metrics')
    if not isinstance(metrics, list):
        raise ValueError('report metrics must be an array')
    for metric in metrics:
        if not isinstance(metric, dict):
            raise ValueError('report metric must be an object')
        for field in ('id', 'title', 'value', 'status', 'narrative', 'basis', 'formula'):
            if not isinstance(metric.get(field), str):
                raise ValueError('report metric ' + field + ' must be a display string')
        if 'grade' not in metric or (metric['grade'] is not None and not isinstance(metric['grade'], str)):
            raise ValueError('report metric grade must be a string or null')
    return report


def read_asset_paths(path, report_mode):
    paths = read_json(path) if path is not None else {}
    if not isinstance(paths, dict) or any(not isinstance(value, str) or not value for value in paths.values()):
        raise ValueError('assets must map image roles to non-empty local PNG paths')
    if report_mode and set(paths) != set(REPORT_IMAGE_ROLES):
        raise ValueError('report assets require exactly seven image roles: ' + ', '.join(REPORT_IMAGE_ROLES))
    # Relative paths belong to the manifest folder, independent of process cwd.
    return {role: Path(value) if Path(value).is_absolute() else path.parent / value
            for role, value in paths.items()}


def read_template():
    provenance = read_json(ROOT / 'template-provenance.json')
    blank = (ROOT / 'blank.hwpx').read_bytes()
    if hashlib.sha256(blank).hexdigest() != provenance['blankSha256']:
        raise ValueError('blank package changed')
    return read_package(blank)


def make_probe_document(mode):
    """Synthetic semantic blocks for viewer QA; never a financial calculation."""
    from report_projection import TextBlock, ImageBlock, PageSpec, ReportDocument
    blocks=[TextBlock('문서 호환성 시험 (합성 자료)','title'),
            TextBlock('(2026.10.29, HWPX 검증)','date')]
    if mode=='probe-table':
        blocks.append(TextBlock('◇ 시험 지표 (정상)\n표 안의 본문도 편집 가능한 합성 자료입니다.','summary'))
    blocks.extend([
        TextBlock('□ 문단과 차트 흐름 확인','heading'),
        TextBlock('이 문서는 실제 업무 자료를 포함하지 않는 합성 자료입니다. 한글 문장이 문단 너비에 따라 자연스럽게 줄바꿈되고 다음 차트와 겹치지 않는지 확인합니다. 그림 뒤에 이어지는 산식과 문장도 순서대로 보존되어야 합니다. & < > 기호도 그대로 표시합니다.'),
    ])
    if mode!='probe-text':blocks.append(ImageBlock('chart',400,110))
    blocks.extend([TextBlock('* 시험 산식: (120 − 20) × 100 ÷ 200 = 50%, Σ = 100; × ÷ − Σ','formula'),
                   TextBlock('그림 다음 문장입니다. 본문·그림·산식이 같은 흐름을 유지하는지 확인합니다.')])
    return ReportDocument('2026/08','2026.10.29',(PageSpec(tuple(blocks)),))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['probe-text', 'probe-image', 'probe-table', 'report'], default='report')
    parser.add_argument('--report', type=Path, help='saved FinancialReport JSON, raw or wrapped in json')
    parser.add_argument('--assets', type=Path, help='JSON mapping of image role to local PNG path')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    report_mode = args.mode == 'report'
    if report_mode and (args.report is None or args.assets is None):
        parser.error('report mode requires --report and --assets')
    if not report_mode and args.report is not None:
        parser.error('synthetic probes do not accept --report')
    ensure_output_is_separate(args.output, [ROOT / 'blank.hwpx', ROOT / 'template-provenance.json',
                                            *(path for path in (args.report, args.assets) if path is not None)])
    document = project_report(read_report(args.report)) if report_mode else make_probe_document(args.mode)
    paths = read_asset_paths(args.assets, report_mode)
    ensure_output_is_separate(args.output, paths.values())
    assets = {role: path.read_bytes() for role, path in paths.items()}
    payload = build_package(build_parts(document, read_template(), assets))
    write_atomic(args.output, payload)
    status = {'mode': args.mode, 'declaredPageLayouts': len(document.pages),
              'images': len(assets), 'sha256': hashlib.sha256(payload).hexdigest(), 'mybox': 'not_run'}
    if report_mode:
        status.update(declaredPageBreaks=len(document.pages) - 1, imageRoles=list(REPORT_IMAGE_ROLES))
    print(json.dumps(status, ensure_ascii=False))


if __name__ == '__main__':
    main()
