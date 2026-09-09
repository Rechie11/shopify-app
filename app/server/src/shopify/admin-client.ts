import { ShopifyApiError } from '../errors.js';

export interface AdminClientOptions {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
}

export { ShopifyApiError };

interface ThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  extensions?: { cost?: { throttleStatus?: ThrottleStatus } };
}

const THROTTLE_FLOOR = 50;
const MAX_THROTTLE_RETRIES = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The Admin GraphQL API meters by a leaky bucket; every response carries
// extensions.cost.throttleStatus. Reading it and sleeping proactively when
// points run low avoids ever hitting THROTTLED in the first place.
// Retrying blindly on 429 is how apps get themselves rate-limited harder.
// See ARCHITECTURE.md §8.
export function createAdminClient(opts: AdminClientOptions) {
  let lastKnownThrottle: ThrottleStatus | undefined;

  async function request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    if (lastKnownThrottle && lastKnownThrottle.currentlyAvailable < THROTTLE_FLOOR) {
      const deficit = THROTTLE_FLOOR - lastKnownThrottle.currentlyAvailable;
      const waitMs = Math.ceil((deficit / lastKnownThrottle.restoreRate) * 1000);
      await sleep(waitMs);
    }

    for (let attempt = 0; attempt <= MAX_THROTTLE_RETRIES; attempt++) {
      const response = await fetch(
        `https://${opts.shopDomain}/admin/api/${opts.apiVersion}/graphql.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': opts.accessToken,
          },
          body: JSON.stringify({ query, variables }),
        },
      );

      if (response.status === 429) {
        await sleep(backoffWithJitter(attempt));
        continue;
      }

      if (!response.ok) {
        throw new ShopifyApiError(`Admin API request failed with ${response.status}`);
      }

      const body = (await response.json()) as GraphqlResponse<T>;
      if (body.extensions?.cost?.throttleStatus) {
        lastKnownThrottle = body.extensions.cost.throttleStatus;
      }

      const isThrottledError = body.errors?.some((e) => e.extensions?.code === 'THROTTLED');
      if (isThrottledError) {
        await sleep(backoffWithJitter(attempt));
        continue;
      }

      if (body.errors && body.errors.length > 0) {
        throw new ShopifyApiError(body.errors.map((e) => e.message).join('; '), body.errors);
      }

      if (body.data === undefined) {
        throw new ShopifyApiError('Admin API response had no data and no errors');
      }
      return body.data;
    }

    throw new ShopifyApiError('Admin API request exhausted retries under sustained throttling');
  }

  return { request };
}

function backoffWithJitter(attempt: number): number {
  const base = 2 ** attempt * 200;
  const jitter = Math.random() * 100;
  return base + jitter;
}
