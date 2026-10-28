"""Immutable print values projected from an already calculated FinancialReport.

These presentation values contain no PDF line coordinates, domain calculations,
file paths, database access or renderer state.
"""
from __future__ import annotations
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class TextBlock:
    text: str
    style: str = 'body'


@dataclass(frozen=True)
class ImageBlock:
    """An image role; None dimensions request fitting its original aspect ratio.

    Explicit dimensions remain available for the minimal native-flow probes.
    The serializer resolves automatic sizing from the PNG and available width.
    """
    role: str
    width_pt: float | None = None
    height_pt: float | None = None


@dataclass(frozen=True)
class SummaryItem:
    label: str
    status: str
    tone: str


@dataclass(frozen=True)
class SummaryBlock:
    items: tuple[SummaryItem, ...]

    def __post_init__(self):
        object.__setattr__(self, 'items', tuple(self.items))


@dataclass(frozen=True)
class MetricBlock:
    title: str
    value: str
    status: str
    narrative: str
    basis: str | None
    formula: str
    image_role: str
    tone: str = 'ink'


@dataclass(frozen=True)
class PageSpec:
    blocks: tuple[TextBlock | ImageBlock | SummaryBlock | MetricBlock, ...]

    def __post_init__(self):
        object.__setattr__(self, 'blocks', tuple(self.blocks))


@dataclass(frozen=True)
class ReportDocument:
    report_month: str
    generated_on: str
    pages: tuple[PageSpec, ...]
    style_profile: Literal['probe', 'report'] = 'probe'

    def __post_init__(self):
        object.__setattr__(self, 'pages', tuple(self.pages))


METRIC_IDS = ('recovery', 'liquidity', 'construction', 'funding', 'cash')


def _tone(metric: Mapping[str, object]) -> str:
    """Mirror report-preview's statusClass; never interpret the financial value."""
    if metric['grade'] == '정상':
        return 'blue'
    if metric['grade'] is not None or metric['status'] == '적정시재 부족':
        return 'crisis'
    return 'ink'


def _project_metric(metric: Mapping[str, object]) -> MetricBlock:
    narrative = metric['narrative']
    if metric['status'] in ('산출 불가', '산출 중') and len(narrative) > 60:
        # Python str counts code points, matching Array.from in the print view.
        narrative = narrative[:59] + '… (상세는 HTML 참고)'
    return MetricBlock(
        title=metric['title'], value=metric['value'], status=metric['status'],
        narrative=narrative,
        basis=metric['basis'] if metric['id'] == 'construction' else None,
        formula=metric['formula'], image_role=metric['id'], tone=_tone(metric),
    )


def project_report(report: Mapping[str, object]) -> ReportDocument:
    """Read saved display strings into the existing three semantic print pages.

    Summary labels/statuses are raw strings; the serializer supplies their
    printed markers. Metric fields likewise retain their strings, with only
    the print view's failure-reason abbreviation applied. Image roles identify
    existing charts/reference tables; this layer does not read or size assets.
    """
    metrics = report['metrics']
    if len(metrics) != len(METRIC_IDS) or {metric['id'] for metric in metrics} != set(METRIC_IDS):
        raise ValueError('exactly five unique metric IDs are required')
    by_id = {metric['id']: metric for metric in metrics}
    summary = SummaryBlock(tuple(SummaryItem(metric['title'], metric['status'], _tone(metric))
                                 for metric in metrics))
    body = {metric_id: _project_metric(by_id[metric_id]) for metric_id in METRIC_IDS}
    return ReportDocument(report['reportMonth'], report['generatedOn'], (
        PageSpec((
            TextBlock(report['title'], 'title'),
            TextBlock('(' + report['generatedOn'] + ', 자금기획팀)', 'date'),
            TextBlock('□ 재무위험지수 종합', 'heading'), summary,
            TextBlock('□ 위험수준 측정결과', 'heading'), body['recovery'], body['liquidity'],
        )),
        PageSpec((body['construction'], body['funding'],
                  TextBlock('□ 적정시재 산정결과', 'heading'), body['cash'])),
        PageSpec((TextBlock('참고', 'reference-header'),
                  TextBlock('□ 위험단계 기준', 'heading'), ImageBlock('referenceRisk'),
                  TextBlock('□ 적정시재 산정방식 (LCR 방식)', 'heading'), ImageBlock('referenceLcr'))),
    ), style_profile='report')
