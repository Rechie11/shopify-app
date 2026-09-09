import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_TIMESTAMP_AGE_SECONDS = 60;

export type AppProxyQuery = Record<string, string | string[] | undefined>;

// Per Shopify's app proxy signing spec: every query param except
// `signature`, multi-values joined with commas, keys sorted
// alphabetically, `key=value` pairs concatenated with NO separator,
// HMAC-SHA256 with the app's client secret, hex-encoded, timing-safe
// compared. The signature alone doesn't prevent replay - callers must
// also check isTimestampFresh. See ARCHITECTURE.md §6.2.
export function verifyAppProxySignature(query: AppProxyQuery, secret: string): boolean {
  const { signature, ...rest } = query;
  if (typeof signature !== 'string' || signature.length === 0) {
    return false;
  }

  const message = Object.keys(rest)
    .sort()
    .map((key) => {
      const value = rest[key];
      const joined = Array.isArray(value) ? value.join(',') : (value ?? '');
      return `${key}=${joined}`;
    })
    .join('');

  const expectedHex = createHmac('sha256', secret).update(message).digest('hex');

  let expected: Buffer;
  let received: Buffer;
  try {
    expected = Buffer.from(expectedHex, 'hex');
    received = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== received.length) {
    return false;
  }
  return timingSafeEqual(expected, received);
}

export function isTimestampFresh(
  timestamp: string | string[] | undefined,
  nowSeconds: number = Date.now() / 1000,
): boolean {
  if (typeof timestamp !== 'string') {
    return false;
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return false;
  }
  return Math.abs(nowSeconds - ts) <= MAX_TIMESTAMP_AGE_SECONDS;
}
