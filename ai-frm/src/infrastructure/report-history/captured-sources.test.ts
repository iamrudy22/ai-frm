import { describe, expect, it } from 'vitest';
import { captureEconomicSource, captureBondSource, redactSourceCredentials, containsSourceCredentials } from './captured-sources';
import type { EconomicIndicatorSource, BondYieldSource } from '../../application/ports';
import { evidenceToJson, evidenceFromJson } from './evidence-codec';
import { SCORING_RULES } from '../../domain/risk/construction-perception/policy';

describe('captured source decorators', () => {
  it('returns the original source object, preserving cache fetchedAt and recording one call', async () => {
    const fetched = { foo: { values: new Map([['2026/07', 1]]), unit: '점', fetchedAt: new Date('2026-08-01Z') } } as never;
    let calls = 0;
    const source: EconomicIndicatorSource = { fetchAll: async () => { calls++; return fetched; } };
    const capture = captureEconomicSource(source);
    expect(await capture.source.fetchAll()).toBe(fetched);
    expect(calls).toBe(1);
    expect(capture.observation()).toEqual({ kind: 'returned', value: fetched });
  });

  it('rethrows the exact Error and distinguishes non-Error throws', async () => {
    const error = new Error('offline');
    const source: BondYieldSource = { dailyYields: async () => { throw error; } };
    const capture = captureBondSource(source);
    await expect(capture.source.dailyYields('2026/07' as never)).rejects.toBe(error);
    expect(capture.observation()).toEqual({ kind: 'threw', errorKind: 'error', message: 'offline' });
    const stringCapture = captureBondSource({ dailyYields: async () => { throw 'offline'; } });
    await expect(stringCapture.source.dailyYields('2026/07' as never)).rejects.toBe('offline');
    expect(stringCapture.observation()).toEqual({ kind: 'threw', errorKind: 'non-error' });
  });

  it('keeps the not-requested state distinct from an empty successful fetch', () => {
    const capture = captureBondSource({ dailyYields: async () => ({ days: [], fetchedAt: new Date() }) });
    expect(capture.observation()).toEqual({ kind: 'not-requested' });
  });

  it('preserves all nine returned Map values and their separate cached fetchedAt in the codec', async () => {
    const names = SCORING_RULES.filter(rule => rule.key !== '분양회수예측오차').map(rule => rule.key);
    const original = Object.fromEntries(names.map((name, index) => [name, {
      values: new Map([['2026/06', index]]), unit: '지수',
      fetchedAt: new Date(`2026-08-${String(index + 1).padStart(2, '0')}T00:00:00Z`),
    }]));
    const source = captureEconomicSource({ fetchAll: async () => original as never });
    await source.source.fetchAll();
    const decoded = evidenceFromJson<{ kind: string; value: typeof original }>(evidenceToJson(source.observation()));
    expect(Object.keys(decoded.value)).toHaveLength(9);
    names.forEach(name => {
      expect(decoded.value[name]).toEqual(original[name]);
    });
  });

  it('redacts query credentials while leaving ordinary source errors unchanged', () => {
    for (const label of ['apiKey', 'token', 'service_key']) {
      const message = `failed https://example.test/feed?${label}=SYNTHETIC_SECRET_123`;
      expect(containsSourceCredentials(message)).toBe(true);
      expect(redactSourceCredentials(message)).not.toContain('SYNTHETIC_SECRET_123');
    }
    expect(redactSourceCredentials('connection refused')).toBe('connection refused');
  });
});
