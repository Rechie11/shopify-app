import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbClient } from '@ember-and-ash/db/client';
import authPlugin from '../../src/http/plugins/auth.js';

const clientId = 'test-client-id';
const clientSecret = 'test-client-secret';
const shop = 'ember-and-ash-dev.myshopify.com';
const encryptionKey = randomBytes(32);

function signToken() {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: `https://${shop}/admin`,
      dest: `https://${shop}`,
      aud: clientId,
      sub: '1',
      jti: 'jti-1',
      sid: 'sid-1',
      nbf: now - 5,
      iat: now - 5,
      exp: now + 60,
    },
    clientSecret,
    { algorithm: 'HS256', noTimestamp: true },
  );
}

// A real MySQL-backed integration test (per ARCHITECTURE.md §12) lives
// alongside repository tests once Testcontainers is wired up. This suite
// stubs the repository layer directly so it can assert the auth plugin's
// HTTP-visible behavior - most importantly the 400 -> 401 + retry-header
// contract - without a live database.
vi.mock('../../src/repositories/shop.repository.js', () => ({
  findOrCreateShopByDomain: vi.fn(),
  readShopAccessToken: vi.fn(),
  saveShopAccessToken: vi.fn(),
}));

import {
  findOrCreateShopByDomain,
  readShopAccessToken,
  saveShopAccessToken,
} from '../../src/repositories/shop.repository.js';

function buildApp() {
  const app = Fastify();
  const db = createDbClient('mysql://unused:unused@localhost:3306/unused');
  app.register(authPlugin, { db, clientId, clientSecret, encryptionKey });
  app.get('/api/whoami', async (request) => ({ shop: request.shop }));
  return app;
}

describe('auth plugin', () => {
  beforeEach(() => {
    vi.mocked(findOrCreateShopByDomain).mockResolvedValue({
      id: 1,
      shopDomain: shop,
      shopifyShopGid: null,
      accessTokenCiphertext: null,
      accessTokenIv: null,
      accessTokenTag: null,
      keyVersion: 1,
      scopes: null,
      currency: null,
      ianaTimezone: null,
      marginFloorBps: 3000,
      marginTargetBps: 5500,
      installedAt: null,
      uninstalledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(readShopAccessToken).mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('rejects a request with no Authorization header', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/whoami' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a garbage session token without calling Shopify', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/whoami',
      headers: { authorization: 'Bearer not-a-real-jwt' },
    });

    expect(response.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exchanges a valid session token and attaches shop context', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'shpat_live', scope: 'read_products' }),
      }),
    );

    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/whoami',
      headers: { authorization: `Bearer ${signToken()}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().shop).toMatchObject({ shopDomain: shop, accessToken: 'shpat_live' });
    expect(saveShopAccessToken).toHaveBeenCalledOnce();
  });

  it('answers 401 with the retry header when Shopify rejects the exchange with 400', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'invalid_subject_token',
      }),
    );

    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/whoami',
      headers: { authorization: `Bearer ${signToken()}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['x-shopify-retry-invalid-session-request']).toBe('1');
  });

  it('answers 502 without the retry header when Shopify has an outage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'internal_error',
      }),
    );

    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/whoami',
      headers: { authorization: `Bearer ${signToken()}` },
    });

    expect(response.statusCode).toBe(502);
    expect(response.headers['x-shopify-retry-invalid-session-request']).toBeUndefined();
  });

  it('uses the cached encrypted token and skips exchange entirely', async () => {
    const { encryptToken } = await import('../../src/shopify/crypto.js');
    const encrypted = encryptToken('shpat_cached', encryptionKey);
    vi.mocked(readShopAccessToken).mockReturnValue(encrypted);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/whoami',
      headers: { authorization: `Bearer ${signToken()}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().shop.accessToken).toBe('shpat_cached');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
