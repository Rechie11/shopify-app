import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SessionTokenError,
  TokenExchangeError,
  exchangeToken,
  shopDomainFromSessionToken,
  verifySessionToken,
} from '../../src/shopify/auth.js';

const clientId = 'test-client-id';
const clientSecret = 'test-client-secret';
const shop = 'ember-and-ash-dev.myshopify.com';

function signToken(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: `https://${shop}/admin`,
    dest: `https://${shop}`,
    aud: clientId,
    sub: '1',
    jti: 'jti-1',
    sid: 'sid-1',
    nbf: now - 5,
    iat: now - 5,
    exp: now + 60,
    ...overrides,
  };
  return jwt.sign(payload, clientSecret, { algorithm: 'HS256', noTimestamp: true });
}

describe('verifySessionToken', () => {
  it('accepts a well-formed token and returns its payload', () => {
    const token = signToken();
    const payload = verifySessionToken(token, { clientId, clientSecret });
    expect(payload.aud).toBe(clientId);
    expect(shopDomainFromSessionToken(payload)).toBe(shop);
  });

  it('rejects a token signed with the wrong secret', () => {
    const token = signToken();
    expect(() => verifySessionToken(token, { clientId, clientSecret: 'wrong-secret' })).toThrow(
      SessionTokenError,
    );
  });

  it('rejects an expired token', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signToken({ exp: now - 100, nbf: now - 200, iat: now - 200 });
    expect(() => verifySessionToken(token, { clientId, clientSecret })).toThrow(SessionTokenError);
  });

  it('rejects a token for a different audience (client id)', () => {
    const token = signToken({ aud: 'some-other-app' });
    expect(() => verifySessionToken(token, { clientId, clientSecret })).toThrow(SessionTokenError);
  });

  it('rejects a token whose iss and dest hosts do not match', () => {
    const token = signToken({ iss: 'https://attacker.myshopify.com/admin' });
    expect(() => verifySessionToken(token, { clientId, clientSecret })).toThrow(/host mismatch/);
  });
});

describe('exchangeToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the access token on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'shpat_123', scope: 'read_products' }),
      }),
    );

    const result = await exchangeToken(shop, 'id-token', { clientId, clientSecret });
    expect(result.accessToken).toBe('shpat_123');
  });

  it('flags a 400 response as retryable with a fresh session token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'invalid_subject_token',
      }),
    );

    await expect(
      exchangeToken(shop, 'stale-id-token', { clientId, clientSecret }),
    ).rejects.toMatchObject({
      shouldRetryWithFreshToken: true,
    } satisfies Partial<TokenExchangeError>);
  });

  it('does not flag a 500 response as retryable with a fresh token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'internal_error',
      }),
    );

    await expect(exchangeToken(shop, 'id-token', { clientId, clientSecret })).rejects.toMatchObject(
      {
        shouldRetryWithFreshToken: false,
      } satisfies Partial<TokenExchangeError>,
    );
  });
});
