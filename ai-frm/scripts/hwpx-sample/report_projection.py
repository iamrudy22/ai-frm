"""Immutable semantic values; FinancialReport projection is a later stage.

These presentation values contain no PDF line coordinates, domain calculations,
file paths, database access or renderer state.
"""
from __future__ import annotations
from dataclasses import dataclass


@dataclass(frozen=True)
class TextBlock:
    text: str
    style: str = 'body'


@dataclass(frozen=True)
class ImageBlock:
    role: str
    width_pt: float
    height_pt: float


@dataclass(frozen=True)
class MetricBlock:
    title: str
    value: str
    status: str
    narrative: str
    basis: str
    formula: str
    image_role: str


@dataclass(frozen=True)
class PageSpec:
    blocks: tuple[TextBlock | ImageBlock | MetricBlock, ...]

    def __post_init__(self):
        object.__setattr__(self, 'blocks', tuple(self.blocks))


@dataclass(frozen=True)
class ReportDocument:
    report_month: str
    generated_on: str
    pages: tuple[PageSpec, ...]

    def __post_init__(self):
        object.__setattr__(self, 'pages', tuple(self.pages))
