import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

import type { Band, Grade } from '@/domain/risk/grade';
import { PAYMENT_RECOVERY_BANDS } from '@/domain/risk/payment-recovery/policy';
import { LIQUIDITY_GAP_BANDS } from '@/domain/risk/liquidity-gap/policy';
import { STAGE_BANDS } from '@/domain/risk/construction-perception/policy';
import { FUNDING_RISK_BANDS } from '@/domain/risk/funding-risk/policy';
import type { ReportMetric, ReportPoint } from './report-model';

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
const PLOT = { left: 58, right: 628, top: 24, bottom: 120 };

function valueText(value: number, cash: boolean): string {
  return new Intl.NumberFormat('ko-KR', {
    maximumFractionDigits: cash ? 0 : 2,
  }).format(value);
}

/** 결측 월은 이어 붙이지 않는다. 점 하나만 있으면 선을 만들지 않는다. */
function segments(
  points: readonly ReportPoint[],
  key: 'value' | 'secondary',
  x: (index: number) => number,
  y: (value: number) => number,
): string[] {
  const paths: string[] = [];
  let segment: string[] = [];
  for (const [index, point] of points.entries()) {
    const value = point[key];
    if (value === null || value === undefined || !Number.isFinite(value)) {
      if (segment.length > 1) paths.push(segment.join(' '));
      segment = [];
      continue;
    }
    segment.push(`${x(index)},${y(value)}`);
  }
  if (segment.length > 1) paths.push(segment.join(' '));
  return paths;
}

export function ReportChart({ metric }: { metric: ReportMetric }) {
  const config = CONFIG[metric.id];
  const cash = metric.id === 'cash';
  const points = metric.points.slice(-18);
  const values = points.flatMap((point) => [point.value, ...(cash ? [point.secondary] : [])])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  if (values.length === 0) {
    return (
      <VStack as="figure" gap={1} className="report-chart border! border-solid border-report-ink/30!" padding={3}>
        <Text type="label" color="inherit" justify="center">{metric.title} 추이</Text>
        <VStack height={118} vAlign="center" hAlign="center" gap={1}>
          <Text size="sm" color="inherit">표시할 추이 자료가 없습니다.</Text>
          <Text size="xsm" color="inherit">{metric.historyNote}</Text>
        </VStack>
      </VStack>
    );
  }

  const min = Math.min(0, ...values);
  const max = Math.max(config.max, ...values.map((value) => value * 1.15));
  const range = max - min || 1;
  const x = (index: number) => points.length === 1
    ? (PLOT.left + PLOT.right) / 2
    : PLOT.left + index * (PLOT.right - PLOT.left) / (points.length - 1);
  const y = (value: number) => PLOT.bottom - ((value - min) / range) * (PLOT.bottom - PLOT.top);
  const ticks = Array.from({ length: 5 }, (_, index) => min + range * index / 4);
  const series = cash
    ? [{ key: 'value' as const, name: '현재시재', color: 'var(--astryx-theme-my-theme-report-line)' },
      { key: 'secondary' as const, name: '적정시재', color: 'var(--astryx-theme-my-theme-report-cash)' }]
    : [{ key: 'value' as const, name: metric.title, color: 'var(--astryx-theme-my-theme-report-line)' }];
  const labelEvery = points.length > 10 ? 2 : 1;

  return (
    <VStack as="figure" gap={1} className="report-chart border! border-solid border-report-ink/30!" padding={2}>
      <Text type="label" color="inherit" size="sm" justify="center">{metric.title} 추이</Text>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img"
        aria-label={`${metric.title} 추이. 단위 ${config.unit}. ${points.length}개 기준월.`}>
        <title>{metric.title} 추이 (단위: {config.unit})</title>
        <desc>{metric.historyNote} 결측 자료는 연결하지 않습니다.</desc>
        {config.bands.map((band, index) => {
          const bottom = Math.max(min, band.atLeast);
          const top = Math.min(max, index === 0 ? max : config.bands[index - 1].atLeast);
          if (top <= bottom) return null;
          return <rect key={band.grade} x={PLOT.left} y={y(top)}
            width={PLOT.right - PLOT.left} height={y(bottom) - y(top)}
            fill={GRADE_FILL[band.grade]} />;
        })}
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PLOT.left} x2={PLOT.right} y1={y(tick)} y2={y(tick)}
              stroke="var(--astryx-theme-my-theme-report-ink)" strokeOpacity={cash ? 0.12 : 0.08} />
            <text x={PLOT.left - 8} y={y(tick) + 4} textAnchor="end"
              fill="var(--astryx-theme-my-theme-report-ink)" className="text-xs">{valueText(tick, cash)}</text>
          </g>
        ))}
        <text x={PLOT.left} y={14} fill="var(--astryx-theme-my-theme-report-ink)" className="text-xs">단위: {config.unit}</text>
        {points.map((point, index) => (index % labelEvery === 0 || index === points.length - 1) && (
          <text key={`${point.month}-${index}`} x={x(index)} y={PLOT.bottom + 18}
            textAnchor="middle" fill="var(--astryx-theme-my-theme-report-ink)" className="text-xs">{point.month}</text>
        ))}
        {series.map((item) => (
          <g key={item.key}>
            {segments(points, item.key, x, y).map((path, index) => (
              <polyline key={index} points={path} fill="none" stroke={item.color}
                strokeWidth={2} strokeLinejoin="round" />
            ))}
            {points.map((point, index) => {
              const value = point[item.key];
              if (value === null || value === undefined || !Number.isFinite(value)) return null;
              const last = index === points.length - 1;
              return (
                <g key={`${point.month}-${index}`}>
                  <circle cx={x(index)} cy={y(value)} r={3.5} fill={item.color} />
                  {(!cash || last || points.length < 7) && (
                    <text x={x(index)} y={y(value) + (item.key === 'secondary' ? 16 : -8)}
                      textAnchor="middle" fill="var(--astryx-theme-my-theme-report-ink)" className="text-xs"
                      fontWeight={last ? 700 : 400}>{valueText(value, cash)}</text>
                  )}
                </g>
              );
            })}
          </g>
        ))}
        {cash ? series.map((item, index) => (
          <g key={item.key}>
            <line x1={248 + index * 108} x2={270 + index * 108} y1={156} y2={156}
              stroke={item.color} strokeWidth={3} />
            <text x={275 + index * 108} y={160} fill="var(--astryx-theme-my-theme-report-ink)"
              className="text-xs">{item.name}</text>
          </g>
        )) : (['정상', '주의', '경고', '위기'] as Grade[]).map((grade, index) => (
          <g key={grade}>
            <rect x={224 + index * 62} y={150} width={17} height={8} fill={GRADE_FILL[grade]} />
            <text x={245 + index * 62} y={158} fill="var(--astryx-theme-my-theme-report-ink)"
              className="text-xs">{grade}</text>
          </g>
        ))}
      </svg>
      <figcaption>
        <Text size="xsm" color="inherit" justify="center">{metric.historyNote}</Text>
      </figcaption>
    </VStack>
  );
}
