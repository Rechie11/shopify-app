import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShopifyApiError, createAdminClient } from '../../src/shopify/admin-client.js';

const opts = {
  shopDomain: 'ember-and-ash-dev.myshopify.com',
  accessToken: 'shpat_x',
  apiVersion: '2026-07',
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

describe('createAdminClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns data on a clean response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: { shop: { name: 'Ember & Ash' } },
          extensions: {
            cost: {
              throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 990, restoreRate: 50 },
            },
          },
        }),
      ),
    );

    const client = createAdminClient(opts);
    const result = await client.request<{ shop: { name: string } }>('query { shop { name } }');
    expect(result.shop.name).toBe('Ember & Ash');
  });

  it('retries on a THROTTLED GraphQL error and eventually succeeds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createAdminClient(opts);
    const resultPromise = client.request('query { ok }');
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws ShopifyApiError on a non-throttling GraphQL error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ errors: [{ message: 'Field does not exist' }] })),
    );

    const client = createAdminClient(opts);
    await expect(client.request('query { bogus }')).rejects.toThrow(ShopifyApiError);
  });

  it('throws ShopifyApiError on a non-2xx, non-429 HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));

    const client = createAdminClient(opts);
    await expect(client.request('query { ok }')).rejects.toThrow(ShopifyApiError);
  });

  it('sleeps proactively before a request when the last known throttle budget is low', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: { a: 1 },
          extensions: {
            cost: {
              throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 10, restoreRate: 50 },
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { b: 2 } }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createAdminClient(opts);
    await client.request('query { a }');

    const secondCallPromise = client.request('query { b }');
    // Should not resolve until the proactive throttle-floor sleep elapses.
    let resolved = false;
    void secondCallPromise.then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(false);

    await vi.runAllTimersAsync();
    await secondCallPromise;
    expect(resolved).toBe(true);
  });
});
