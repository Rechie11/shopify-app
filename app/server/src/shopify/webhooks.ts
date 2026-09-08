import { createHmac, timingSafeEqual } from 'node:crypto';

// HMAC-SHA256 over the *raw* body, timing-safe compare. Computing this over
// a re-serialized JSON body is the classic bug here - the raw bytes must be
// preserved by the content-type parser. See ARCHITECTURE.md §6.3.
export function verifyWebhookHmac(rawBody: Buffer, hmacHeader: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest();

  let received: Buffer;
  try {
    received = Buffer.from(hmacHeader, 'base64');
  } catch {
    return false;
  }

  if (received.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(received, expected);
}
