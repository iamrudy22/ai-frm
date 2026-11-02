import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localOrigin } from './report-history-handlers';

const publicOrigin = 'https://aifrm.brainbackdoor.com';
const publicHost = 'aifrm.brainbackdoor.com';
const path = '/api/report-history/manual-entries';

beforeEach(() => vi.stubEnv('AIFRM_PUBLIC_ORIGIN', undefined));
afterEach(() => vi.unstubAllEnvs());

describe('report history request origin boundary', () => {
  it.each(['http', 'https'])('allows the configured public origin through an %s origin connection', protocol => {
    vi.stubEnv('AIFRM_PUBLIC_ORIGIN', publicOrigin);
    const request = new Request(`${protocol}://${publicHost}${path}`, {
      method: 'POST', headers: { host: publicHost, origin: publicOrigin }, body: '{}',
    });
    expect(localOrigin(request)).toBe(true);
  });

  it('allows a same-host GET without Origin for the protected public application', () => {
    vi.stubEnv('AIFRM_PUBLIC_ORIGIN', publicOrigin);
    expect(localOrigin(new Request(`http://${publicHost}${path}`, { headers: { host: publicHost } }))).toBe(true);
  });

  it.each(['localhost:3002', '127.0.0.1:3002', '[::1]:3002'])('allows Next-normalized loopback URL %s only with the configured public Host', internalHost => {
    vi.stubEnv('AIFRM_PUBLIC_ORIGIN', publicOrigin);
    const url = `http://${internalHost}${path}`;
    expect(localOrigin(new Request(url, { headers: { host: publicHost, origin: publicOrigin } }))).toBe(true);
    expect(localOrigin(new Request(url, { headers: { host: publicHost } }))).toBe(true);
  });

  it('denies the public host by default', () => {
    expect(localOrigin(new Request(`https://${publicHost}${path}`, { headers: { host: publicHost, origin: publicOrigin } }))).toBe(false);
  });

  it.each([
    'http://aifrm.brainbackdoor.com',
    'https://aifrm.brainbackdoor.com:444',
    'https://aifrm.brainbackdoor.com.evil.test',
    'null',
    'https://aifrm.brainbackdoor.com/path',
  ])('rejects the mismatched browser Origin %s', origin => {
    vi.stubEnv('AIFRM_PUBLIC_ORIGIN', publicOrigin);
    expect(localOrigin(new Request(`http://${publicHost}${path}`, { headers: { host: publicHost, origin } }))).toBe(false);
  });

  it.each([
    { url: 'http://foreign.test', host: publicHost },
    { url: `http://${publicHost}`, host: 'foreign.test' },
    { url: `http://${publicHost}:3002`, host: publicHost },
    { url: `http://${publicHost}`, host: `${publicHost}:3002` },
    { url: 'http://localhost:3002', host: 'unlisted.brainbackdoor.com' },
    { url: 'http://localhost:3002', host: `${publicHost}:3002` },
    { url: `http://${publicHost}`, host: '127.0.0.1:3002' },
  ])('rejects URL/Host authority mismatch %#', ({ url, host }) => {
    vi.stubEnv('AIFRM_PUBLIC_ORIGIN', publicOrigin);
    expect(localOrigin(new Request(`${url}${path}`, { headers: { host, origin: publicOrigin } }))).toBe(false);
  });

  it('requires an explicit public Host and ignores forwarded authority claims', () => {
    vi.stubEnv('AIFRM_PUBLIC_ORIGIN', publicOrigin);
    expect(localOrigin(new Request(`https://${publicHost}${path}`, { headers: { origin: publicOrigin } }))).toBe(false);
    expect(localOrigin(new Request(`http://foreign.test${path}`, {
      headers: { host: 'foreign.test', origin: publicOrigin, 'x-forwarded-host': publicHost, 'x-forwarded-proto': 'https', forwarded: `host=${publicHost};proto=https` },
    }))).toBe(false);
  });

  it.each([undefined, 'invalid'])('does not enable a public Host on normalized URLs without valid configuration %s', configuredOrigin => {
    vi.stubEnv('AIFRM_PUBLIC_ORIGIN', configuredOrigin);
    expect(localOrigin(new Request(`http://localhost:3002${path}`, { headers: { host: publicHost, origin: publicOrigin } }))).toBe(false);
  });

  it.each(['http://aifrm.brainbackdoor.com', 'https://aifrm.brainbackdoor.com:444', 'https://foreign.test', 'null'])('rejects mismatched Origin %s on normalized URLs', origin => {
    vi.stubEnv('AIFRM_PUBLIC_ORIGIN', publicOrigin);
    expect(localOrigin(new Request(`http://localhost:3002${path}`, { headers: { host: publicHost, origin } }))).toBe(false);
  });

  it.each([
    '', 'not a URL', '*', 'http://aifrm.brainbackdoor.com',
    'https://*.brainbackdoor.com', 'https://user:pass@aifrm.brainbackdoor.com',
    'https://aifrm.brainbackdoor.com/aifrm', 'https://aifrm.brainbackdoor.com?allow=all',
    'https://aifrm.brainbackdoor.com#fragment',
  ])('fails closed for invalid public configuration %s', configuredOrigin => {
    vi.stubEnv('AIFRM_PUBLIC_ORIGIN', configuredOrigin);
    expect(localOrigin(new Request(`https://${publicHost}${path}`, { headers: { host: publicHost, origin: publicOrigin } }))).toBe(false);
  });

  it.each([undefined, publicOrigin, 'invalid'])('preserves localhost access with public configuration %s', configuredOrigin => {
    vi.stubEnv('AIFRM_PUBLIC_ORIGIN', configuredOrigin);
    for (const host of ['localhost:3002', '127.0.0.1:3002', '[::1]:3002']) {
      const url = `http://localhost:3002${path}`;
      expect(localOrigin(new Request(url, { headers: { host, origin: `http://${host}` } }))).toBe(true);
      expect(localOrigin(new Request(url, { headers: { host } }))).toBe(true);
    }
  });

  it('rejects a public Origin on the local-only Host even after opt-in', () => {
    vi.stubEnv('AIFRM_PUBLIC_ORIGIN', publicOrigin);
    expect(localOrigin(new Request(`http://localhost:3002${path}`, { headers: { host: '127.0.0.1:3002', origin: publicOrigin } }))).toBe(false);
  });
});
