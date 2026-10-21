import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

import type { Band, Grade } from '@/domain/risk/grade';
import { PAYMENT_RECOVERY_BANDS } from '@/domain/risk/payment-recovery/policy';
import { LIQUIDITY_GAP_BANDS } from '@/domain/risk/liquidity-gap/policy';
import { STAGE_BANDS } from '@/domain/risk/construction-perception/policy';
import { FUNDING_RISK_BANDS } from '@/domain/risk/funding-risk/policy';
import type { ReportMetric } from './report-model';
import { splitChartSegments, type ChartDatum } from './report-chart-view';
import type { StatementReferenceTrends } from './report-reference';

const GRADE_FILL: Record<Grade, string> = {
  정상: 'var(--astryx-theme-my-theme-report-normal)',
  주의: 'var(--astryx-theme-my-theme-report-caution)',
  경고: 'var(--astryx-theme-my-theme-report-warning)',
  위기: 'var(--astryx-theme-my-theme-report-crisis)',
};

const CONFIG: Record<ReportMetric['id'], { unit: string; max: number; bands: readonly Band[] }> = {
  recovery: { unit: '배', max: 2, bands: PAYMENT_RECOVERY_BANDS },
  liquidity: { unit: '배', max: 4, bands: LIQUIDITY_GAP_BANDS },
  construction: { unit: '지수', max: 80, bands: STAGE_BANDS },
  funding: { unit: '%p', max: 1, bands: FUNDING_RISK_BANDS },
  cash: { unit: '억원', max: 1, bands: [] },
};

const WIDTH = 660;
const HEIGHT = 164;
const PLOT = { left: 76, right: 628, top: 24, bottom: 120 };
const INK = 'var(--astryx-theme-my-theme-report-ink)';
const LINE = 'var(--astryx-theme-my-theme-report-line)';
const SECONDARY = 'var(--astryx-theme-my-theme-report-cash)';
type ChartSeries = { name: string; color: string; points: readonly ChartDatum[] };

type ChartFrameProps = {
  title: string;
  unit: string;
  minimumMax: number;
  bands: readonly Band[];
  series: readonly ChartSeries[];
  note: string;
  emptyMessage: string;
  reference?: boolean;
};

function valueText(value: number, unit: string): string {
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: unit === '억원' ? 0 : unit === '%p' ? 3 : 2 }).format(value);
}

/** 위험 이력과 참고 금액은 어댑터에서 투영하고 축·선·접근성은 같은 SVG로 표시한다. */
function ChartFrame({ title, unit, minimumMax, bands, series, note, emptyMessage, reference = false }: ChartFrameProps) {
  const points = series[0]?.points ?? [];
  const values = series.flatMap((item) => item.points.flatMap((point) =>
    point.kind === 'available' && Number.isFinite(point.value) ? [point.value] : []));
  if (values.length === 0) {
    return (
      <VStack as="figure" gap={1} className="report-chart border! border-solid border-report-ink/30!" padding={3}>
        <Text type="label" color="inherit" justify="center">{title}</Text>
        <Text size="sm" color="inherit" justify="center">{emptyMessage}</Text>
        <figcaption><Text size="xsm" color="inherit" justify="center">{note}</Text></figcaption>
      </VStack>
    );
  }

  const lowest = Math.min(0, ...values);
  const highest = Math.max(minimumMax, ...values);
  const padding = (highest - lowest || 1) * 0.1;
  const min = lowest < 0 ? lowest - padding : 0;
  const max = highest + padding;
  const range = max - min;
  const x = (index: number) => points.length === 1 ? (PLOT.left + PLOT.right) / 2
    : PLOT.left + index * (PLOT.right - PLOT.left) / (points.length - 1);
  const y = (value: number) => PLOT.bottom - ((value - min) / range) * (PLOT.bottom - PLOT.top);
  const ticks = Array.from({ length: 5 }, (_, index) => min + range * index / 4);
  const labelEvery = points.length > 10 ? 2 : 1;
  const anchor = (index: number) => points.length === 1 ? 'middle'
    : index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle';
  const valueLabelX = (index: number) => x(index) + (points.length === 1 ? 0
    : index === 0 ? 4 : index === points.length - 1 ? -4 : 0);
  // 두 계열의 값 라벨만 조정한다. 축·월·단위 영역은 피하고 같은 월의 값은 16 이상 띄운다.
  const valueLabelYs = points.map((_, index) => {
    const clamp = (position: number) => Math.max(PLOT.top + 10, Math.min(PLOT.bottom - 8, position));
    const positions = series.map((item, seriesIndex) => {
      const point = item.points[index];
      return point?.kind === 'available' && Number.isFinite(point.value)
        ? clamp(y(point.value) + (seriesIndex === 1 ? 16 : -8)) : null;
    });
    const [primary, secondary] = positions;
    if (primary !== null && secondary != null && Math.abs(primary - secondary) < 16) {
      const center = Math.max(PLOT.top + 18, Math.min(PLOT.bottom - 16, (primary + secondary) / 2));
      return primary <= secondary ? [center - 8, center + 8] : [center + 8, center - 8];
    }
    return positions;
  });

  return (
    <VStack as="figure" gap={1} className="report-chart border! border-solid border-report-ink/30!" padding={2}>
      <Text type="label" color="inherit" size="sm" justify="center">{title}</Text>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img"
        aria-label={`${title}. 단위 ${unit}. ${points.length}개 기준월. ${note}`}>
        <title>{`${title} (단위: ${unit})`}</title>
        <desc>{note} 결측과 비적용 월은 연결하지 않습니다.</desc>
        {bands.map((band, index) => {
          const bottom = Math.max(min, band.atLeast);
          const top = Math.min(max, index === 0 ? max : bands[index - 1].atLeast);
          if (top <= bottom) return null;
          return <rect key={band.grade} x={PLOT.left} y={y(top)} width={PLOT.right - PLOT.left}
            height={y(bottom) - y(top)} fill={GRADE_FILL[band.grade]} />;
        })}
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PLOT.left} x2={PLOT.right} y1={y(tick)} y2={y(tick)} stroke={INK} strokeOpacity={0.1} />
            <text x={PLOT.left - 8} y={y(tick) + 4} textAnchor="end" fill={INK}
              className="text-xs">{valueText(tick, unit)}</text>
          </g>
        ))}
        <text x={PLOT.left} y={14} fill={INK} className="text-xs">단위: {unit}</text>
        {points.map((point, index) => (index === points.length - 1
          || (index % labelEvery === 0 && index <= points.length - 1 - labelEvery)) && (
          <text key={point.month} x={x(index)} y={PLOT.bottom + 18} textAnchor="middle"
            fill={INK} className="text-xs">{point.month}</text>
        ))}
        {series.map((item, seriesIndex) => (
          <g key={item.name} data-series={item.name}>
            {splitChartSegments(item.points).map((segment, index) => (
              <polyline key={index} points={segment.indices.map((i) => `${x(i)},${y(item.points[i].value!)}`).join(' ')}
                fill="none" stroke={item.color} strokeWidth={2} strokeLinejoin="round"
                strokeDasharray={segment.planned ? '6 4' : undefined} />
            ))}
            {item.points.map((point, index) => {
              if (point.kind !== 'available' || !Number.isFinite(point.value)) return null;
              const last = index === points.length - 1;
              return (
                <g key={point.month}>
                  <circle cx={x(index)} cy={y(point.value)} r={3.5} fill={item.color}>
                    <title>{`${point.month} ${item.name}: ${valueText(point.value, unit)} ${unit}${reference ? point.planned ? ' (계획)' : ' (실적)' : ''}`}</title>
                  </circle>
                  {((!reference && series.length === 1) || last || points.length < 7) && (
                    <text x={valueLabelX(index)} y={valueLabelYs[index][seriesIndex]!} textAnchor={anchor(index)}
                      fill={INK} className="text-xs" fontWeight={last ? 700 : 400}>{valueText(point.value, unit)}</text>
                  )}
                </g>
              );
            })}
          </g>
        ))}
        {bands.length > 0 ? (['정상', '주의', '경고', '위기'] as Grade[]).map((grade, index) => (
          <g key={grade}>
            <rect x={224 + index * 62} y={150} width={17} height={8} fill={GRADE_FILL[grade]} />
            <text x={245 + index * 62} y={158} fill={INK} className="text-xs">{grade}</text>
          </g>
        )) : series.map((item, index) => (
          <g key={item.name}>
            <line x1={(reference ? 90 : 248) + index * 108} x2={(reference ? 112 : 270) + index * 108}
              y1={156} y2={156} stroke={item.color} strokeWidth={3} />
            <text x={(reference ? 117 : 275) + index * 108} y={160} fill={INK} className="text-xs">{item.name}</text>
          </g>
        ))}
        {reference && <g>
          <line x1={390} x2={412} y1={156} y2={156} stroke={INK} strokeWidth={2} />
          <text x={417} y={160} fill={INK} className="text-xs">실적</text>
          <line x1={466} x2={488} y1={156} y2={156} stroke={INK} strokeWidth={2} strokeDasharray="6 4" />
          <text x={493} y={160} fill={INK} className="text-xs">계획</text>
        </g>}
      </svg>
      <figcaption><Text size="xsm" color="inherit" justify="center">{note}</Text></figcaption>
    </VStack>
  );
}

export function ReportChart({ metric }: { metric: ReportMetric }) {
  const config = CONFIG[metric.id];
  const points = metric.points.slice(-18);
  const cash = metric.id === 'cash';
  // 비교 불가능한 시재 월은 두 선 모두 끊는다. coverage용 원천 검사와 같은 기준이다.
  const primary: ChartDatum[] = points.map((point) => cash && point.kind === 'available'
    && (!Number.isFinite(point.value) || !Number.isFinite(point.secondary))
    ? { month: point.month, kind: 'missing', value: null, reason: '현재시재와 적정시재 비교 자료가 없습니다.' } : point);
  const series: ChartSeries[] = [{ name: cash ? '현재시재' : metric.title, color: LINE, points: primary }];
  if (cash) series.push({ name: '적정시재', color: SECONDARY, points: primary.map((point, index): ChartDatum =>
    point.kind === 'available' ? { ...point, value: points[index].secondary! } : point) });
  const emptyMessage = metric.historyCoverage.notApplicableMonths.length > 0
    ? `비율 비적용 ${metric.historyCoverage.notApplicableMonths.length}개월`
    : `${metric.status}: ${metric.narrative}`;
  return <ChartFrame title={`${metric.title} 추이`} unit={config.unit} minimumMax={config.max}
    bands={config.bands} series={series} note={metric.historyNote} emptyMessage={emptyMessage} />;
}

/** Amount는 참고자료 어댑터에서만 표시용 number로 투영한다. */
export function StatementReferenceChart({ trend, chart }: {
  trend: StatementReferenceTrends;
  chart: StatementReferenceTrends['charts'][number];
}) {
  const series: ChartSeries[] = chart.series.map((item, index) => ({
    name: item.item, color: index === 0 ? LINE : SECONDARY,
    points: item.points.map((point): ChartDatum => {
      const planned = point.nature === 'plan' || point.nature === 'planned-opening-balance';
      return point.kind === 'available'
        ? { month: point.month, kind: 'available', value: Number(point.value), planned }
        : { month: point.month, kind: 'missing', value: null, reason: point.reason, planned };
    }),
  }));
  const reasons = [...new Set(chart.series.flatMap((item) => item.points.flatMap((point) =>
    point.kind === 'missing' ? [`${item.item}: ${point.reason}`] : [])))];
  const omitted = [trend.window.omittedBefore, trend.window.omittedAfter].flatMap((range) => range === null
    ? [] : [`${range.from}~${range.to} ${range.count}개월 생략`]);
  const note = [`출처: ${trend.sourceFile} · ${trend.sourceRound} 회차`, trend.note,
    '실적 실선 · 계획 점선 (기초시재는 기준월 잔고 포함, 이후 계획 이월 잔고)',
    ...(chart.series.some((item) => item.points.some((point) => point.beyondPlanYear)) ? ['다음 해 미확정 계획 포함'] : []),
    ...omitted, ...reasons].join(' · ');
  return <ChartFrame title={`${chart.series.map((item) => item.item).join('·')} 월별 금액`} unit={trend.unit}
    minimumMax={0} bands={[]} series={series} note={note} emptyMessage="금액 자료를 표시할 수 없습니다." reference />;
}
