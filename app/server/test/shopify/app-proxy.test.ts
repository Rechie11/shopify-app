import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isTimestampFresh, verifyAppProxySignature } from '../../src/shopify/app-proxy.js';

const SECRET = 'test-secret';

function sign(query: Record<string, string>): string {
  const message = Object.keys(query)
    .sort()
    .map((key) => `${key}=${query[key]}`)
    .join('');
  return createHmac('sha256', SECRET).update(message).digest('hex');
}

describe('verifyAppProxySignature', () => {
  it('accepts a correctly signed request', () => {
    const query = { shop: 'ember-and-ash-dev.myshopify.com', timestamp: '1700000000', path_prefix: '/apps/flights' };
    const signature = sign(query);
    expect(verifyAppProxySignature({ ...query, signature }, SECRET)).toBe(true);
  });

  it('rejects a tampered parameter', () => {
    const query = { shop: 'ember-and-ash-dev.myshopify.com', timestamp: '1700000000' };
    const signature = sign(query);
    expect(
      verifyAppProxySignature({ shop: 'attacker.myshopify.com', timestamp: '1700000000', signature }, SECRET),
    ).toBe(false);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const query = { shop: 'ember-and-ash-dev.myshopify.com', timestamp: '1700000000' };
    const signature = createHmac('sha256', 'wrong-secret').update('shop=ember-and-ash-dev.myshopify.comtimestamp=1700000000').digest('hex');
    expect(verifyAppProxySignature({ ...query, signature }, SECRET)).toBe(false);
  });

  it('rejects when signature is missing', () => {
    expect(verifyAppProxySignature({ shop: 'x.myshopify.com' }, SECRET)).toBe(false);
  });

  it('rejects a non-hex signature without throwing', () => {
    expect(() =>
      verifyAppProxySignature({ shop: 'x.myshopify.com', signature: 'not-hex-!!' }, SECRET),
    ).not.toThrow();
    expect(verifyAppProxySignature({ shop: 'x.myshopify.com', signature: 'not-hex-!!' }, SECRET)).toBe(
      false,
    );
  });

  it('joins multi-value params with commas before signing, matching Shopify', () => {
    const message = 'ids=1,2,3shop=x.myshopify.com';
    const signature = createHmac('sha256', SECRET).update(message).digest('hex');
    expect(
      verifyAppProxySignature({ ids: ['1', '2', '3'], shop: 'x.myshopify.com', signature }, SECRET),
    ).toBe(true);
  });
});

describe('isTimestampFresh', () => {
  const now = 1_700_000_100;

  it('accepts a timestamp within the 60 second window', () => {
    expect(isTimestampFresh('1700000060', now)).toBe(true);
    expect(isTimestampFresh(String(now), now)).toBe(true);
    expect(isTimestampFresh('1700000040', now)).toBe(true);
  });

  it('rejects a timestamp older than 60 seconds', () => {
    expect(isTimestampFresh('1700000039', now)).toBe(false);
  });

  it('rejects a timestamp from the future beyond the window', () => {
    expect(isTimestampFresh('1700000200', now)).toBe(false);
  });

  it('rejects a missing or non-numeric timestamp', () => {
    expect(isTimestampFresh(undefined, now)).toBe(false);
    expect(isTimestampFresh('not-a-number', now)).toBe(false);
  });
});
