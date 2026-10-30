"""Small synthetic-only stage 5 QA variations of a saved FinancialReport.

Use build_variants(read_report(path)) for validated in-memory DTOs.
The existing generate_sample.read_report owns source-file validation; this
module only creates values and has no CLI or file-persistence boundary.

The baseline preserves every saved field. Other variants deep-copy it and set
explicit display values and chart samples; no domain formula or grade is run.
Both raw reports and the existing {"json": report} saved wrapper are accepted.
Month arithmetic only constructs valid YYYY/MM chart labels. ReportChart's
YearMonth contract disallows arbitrary long axis strings, so boundary variants
use all 18 full year/month labels plus long figure/series titles and basis text.
Actual MYBOX pagination/figure rendering is a separate acceptance check.
"""
from __future__ import annotations

import copy
from collections.abc import Mapping

from report_projection import project_report


LONG_REASON = '가' * 58 + '😀나다 <검증> & 기호 × ÷ − Σ · 👩\u200d💻 e\u0301 자료를 확인하고 있습니다.'
# Hand-set chart samples, deliberately independent of report formulas/grades.
SAMPLES = (1.00, 0.00, -0.25, 0.50, 1.25, 0.75, 1.50, 1.00, 0.50,
           1.75, 1.00, 0.25, 1.50, 0.75, 1.25, 1.00, 0.50, 1.00)
SECONDARY = (0.50, 0.50, 0.25, 0.75, 1.00, 0.50, 1.25, 0.75, 0.50,
             1.00, 0.75, 0.25, 1.25, 0.50, 1.00, 0.75, 0.50, 0.75)


def _months_ending(month: str, count: int) -> list[str]:
    year, number = map(int, month.split('/'))
    end = year * 12 + number - 1
    return [f'{index // 12:04d}/{index % 12 + 1:02d}' for index in range(end - count + 1, end + 1)]


def _set_points(metric: dict, points: list[dict]) -> None:
    """Keep the chart view's metadata consistent; only count sample kinds."""
    metric['points'] = points
    available = [p['month'] for p in points if p['kind'] == 'available']
    metric['historyCoverage'] = {
        'from': points[0]['month'] if points else None,
        'to': points[-1]['month'] if points else None,
        'totalMonths': len(points), 'availableMonths': available,
        'missingMonths': [p['month'] for p in points if p['kind'] == 'missing'],
        'notApplicableMonths': [p['month'] for p in points if p['kind'] == 'not-applicable'],
        'kind': 'empty' if not available else 'single' if len(available) == 1 else 'multiple',
    }
    metric['historyNote'] = '합성 QA 고정 표본 · 결측과 비적용 월은 연결하지 않음.'


def _available_points(metric: dict, months: list[str]) -> None:
    points = [{'month': month, 'kind': 'available', 'value': SAMPLES[index]}
              for index, month in enumerate(months)]
    if metric['id'] == 'cash':
        for index, point in enumerate(points):
            point['secondary'] = SECONDARY[index]
    _set_points(metric, points)


def build_variants(saved_report: Mapping[str, object]) -> dict[str, dict]:
    """Return independent raw report DTOs from a validated synthetic saved DTO.

    No I/O or financial computation. Existing read_report owns file validation;
    project_report supplies the existing metric identity/order gate here.
    """
    report = saved_report.get('json', saved_report)
    project_report(report)
    names = ('baseline', 'year-end', 'year-start', 'zero-negative-netinflow',
             'partial-unavailable', 'all-unavailable', 'one-point')
    variants = {name: copy.deepcopy(report) for name in names}

    for name, month in (('year-end', '2026/12'), ('year-start', '2027/01')):
        variant = variants[name]
        variant.update(reportMonth=month, latestRound=month,
                       title=f'재무위험관리시스템 현황 보고 ({month})')
        for metric in variant['metrics']:
            metric['title'] += ' <긴 제목> & 연말연초 기준월 표시 확인'
            metric['basis'] = f'{month} 합성 기준 · 긴 기준 문구 × ÷ − Σ & <검증>'
            _available_points(metric, _months_ending(month, 18))

    boundary = {m['id']: m for m in variants['zero-negative-netinflow']['metrics']}
    boundary['recovery'].update(value='0.00', status='위기', grade='위기', narrative='회수 표시값 0.00을 그대로 보존합니다.')
    boundary['liquidity'].update(value='—', status='정상 순유입', grade=None,
        narrative='향후 3개월 순유입 -25 억원으로 비율을 적용하지 않습니다. 0·음수·순유입의 저장 문구입니다.')
    boundary['construction'].update(value='0', status='정상', grade='정상', narrative='지수 0은 유효한 저장 표시값입니다.')
    boundary['funding'].update(value='-0.125%p', status='정상', grade='정상', narrative='금리 차이 -0.125%p의 저장 판정을 유지합니다.')
    boundary['cash'].update(value='-17 억원', status='적정시재 부족', grade=None,
        narrative='현재시재 -17 억원, 적정시재 0 억원의 합성 저장 문구입니다.')
    for metric in boundary.values():
        points = [{'month': '2026/07', 'kind': 'available', 'value': 0},
                  {'month': '2026/08', 'kind': 'available', 'value': -0.125}]
        if metric['id'] == 'cash':
            points = [{'month': '2026/07', 'kind': 'available', 'value': 0, 'secondary': 0},
                      {'month': '2026/08', 'kind': 'available', 'value': -17, 'secondary': 0}]
        if metric['id'] == 'liquidity':
            points = [{'month': month, 'kind': 'not-applicable', 'value': None,
                       'reason': '정상 순유입으로 비율 비적용'} for month in ('2026/07', '2026/08')]
        _set_points(metric, points)

    for metric in variants['partial-unavailable']['metrics']:
        if metric['id'] in ('recovery', 'funding'):
            metric.update(value='—', status='산출 불가' if metric['id'] == 'recovery' else '산출 중',
                          grade=None, narrative=LONG_REASON)
            _set_points(metric, [{'month': '2026/08', 'kind': 'missing', 'value': None, 'reason': LONG_REASON}])
    for metric in variants['all-unavailable']['metrics']:
        metric.update(value='—', status='산출 불가', grade=None, narrative=LONG_REASON)
        _set_points(metric, [])
    for metric in variants['one-point']['metrics']:
        _available_points(metric, ['2026/08'])
    return variants

