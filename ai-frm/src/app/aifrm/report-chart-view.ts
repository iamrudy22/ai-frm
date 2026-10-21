import { addMonths, type YearMonth } from '@/domain/shared/year-month';

export type ChartDatum = { month: YearMonth; planned?: boolean } & (
  | { kind: 'available'; value: number }
  | { kind: 'missing' | 'not-applicable'; value: null; reason: string }
);

export type HistoryCoverage = {
  from: YearMonth | null;
  to: YearMonth | null;
  totalMonths: number;
  availableMonths: readonly YearMonth[];
  missingMonths: readonly YearMonth[];
  notApplicableMonths: readonly YearMonth[];
  kind: 'empty' | 'single' | 'multiple';
};

export type ChartSegment = { planned: boolean; indices: readonly number[] };

function isAvailable(point: ChartDatum): boolean {
  return point.kind === 'available' && Number.isFinite(point.value);
}

/** kind는 수치 확보 개수이며 비적용·실패 등 현재 지표 상태를 대체하지 않는다. */
export function summarizeHistory(points: readonly ChartDatum[]): HistoryCoverage {
  const availableMonths: YearMonth[] = [];
  const missingMonths: YearMonth[] = [];
  const notApplicableMonths: YearMonth[] = [];
  for (const point of points) {
    if (isAvailable(point)) availableMonths.push(point.month);
    else if (point.kind === 'not-applicable') notApplicableMonths.push(point.month);
    else missingMonths.push(point.month);
  }
  return {
    from: points[0]?.month ?? null,
    to: points[points.length - 1]?.month ?? null,
    totalMonths: points.length,
    availableMonths,
    missingMonths,
    notApplicableMonths,
    kind: availableMonths.length === 0 ? 'empty' : availableMonths.length === 1 ? 'single' : 'multiple',
  };
}

/** 인접 선분마다 스타일을 한 번 정한 뒤 같은 스타일의 연속 선분만 합친다. */
export function splitChartSegments(points: readonly ChartDatum[]): readonly ChartSegment[] {
  const segments: { planned: boolean; indices: number[] }[] = [];
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const current = points[i];
    if (!isAvailable(previous) || !isAvailable(current) || addMonths(previous.month, 1) !== current.month) continue;

    // 실적·계획의 접점을 포함하는 선분은 계획 구간에만 속한다.
    const planned = previous.planned === true || current.planned === true;
    const last = segments[segments.length - 1];
    if (last && last.planned === planned && last.indices[last.indices.length - 1] === i - 1) {
      last.indices.push(i);
    } else {
      segments.push({ planned, indices: [i - 1, i] });
    }
  }
  return segments;
}
