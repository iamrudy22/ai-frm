import type { BondYieldSource, EconomicIndicatorSource, SourceResult, YieldFetch } from '../../application/ports';
import type { SourceObservation } from '../../application/report-history/ports';

function thrown(error: unknown): SourceObservation<never> {
  return error instanceof Error
    ? { kind: 'threw', errorKind: 'error', message: error.message }
    : { kind: 'threw', errorKind: 'non-error' };
}

export function captureEconomicSource(source: EconomicIndicatorSource): {
  readonly source: EconomicIndicatorSource;
  readonly observation: () => SourceObservation<SourceResult>;
} {
  let seen: SourceObservation<SourceResult> = { kind: 'not-requested' };
  return {
    source: { async fetchAll() {
      try {
        const value = await source.fetchAll();
        seen = { kind: 'returned', value };
        return value;
      } catch (error) {
        seen = thrown(error);
        throw error;
      }
    } },
    observation: () => seen,
  };
}

export function captureBondSource(source: BondYieldSource): {
  readonly source: BondYieldSource;
  readonly observation: () => SourceObservation<YieldFetch>;
} {
  let seen: SourceObservation<YieldFetch> = { kind: 'not-requested' };
  return {
    source: { async dailyYields(month) {
      try {
        const value = await source.dailyYields(month);
        seen = { kind: 'returned', value };
        return value;
      } catch (error) {
        seen = thrown(error);
        throw error;
      }
    } },
    observation: () => seen,
  };
}

function replay<T>(observed: SourceObservation<T>): T {
  if (observed.kind === 'returned') return observed.value;
  if (observed.kind === 'threw') throw observed.errorKind === 'error' ? new Error(observed.message) : 'upstream non-error throw';
  throw Error('UNCAPTURED_SOURCE');
}

/** A persisted observation is the sole input to a historical calculation. */
export function replayEconomicSource(observed: SourceObservation<SourceResult>): EconomicIndicatorSource {
  return { async fetchAll() { return replay(observed); } };
}
export function replayBondSource(observed: SourceObservation<YieldFetch>): BondYieldSource {
  return { async dailyYields() { return replay(observed); } };
}

/** Only source credential forms are redacted at the HTTP boundary. */
export function redactSourceCredentials(text: string): string {
  return text
    .replace(/https?:\/\/[^\s"'<>]+/gi, url => /\/StatisticSearch\/[^/\s?]+|[?&](?:api[_-]?key|service[_-]?key|auth[_-]?key|token|password)=/i.test(url) ? '[redacted source URL]' : url)
    .replace(/\b(api[_-]?key|service[_-]?key|auth[_-]?key|token|password)=([^\s&"'<>]+)/gi, '$1=[redacted]');
}

export function containsSourceCredentials(value: unknown): boolean {
  const json = JSON.stringify(value);
  return typeof json === 'string' && redactSourceCredentials(json) !== json;
}
