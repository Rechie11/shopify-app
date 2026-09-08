import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyWebhookHmac } from '../../src/shopify/webhooks.js';

const secret = 'shhh-its-a-secret';

function sign(body: Buffer): string {
  return createHmac('sha256', secret).update(body).digest('base64');
}

describe('verifyWebhookHmac', () => {
  it('accepts a correctly signed raw body', () => {
    const body = Buffer.from(JSON.stringify({ id: 1, topic: 'orders/create' }));
    expect(verifyWebhookHmac(body, sign(body), secret)).toBe(true);
  });

  it('rejects a body that was re-serialized after signing', () => {
    // Same JSON value, different byte-for-byte serialization (whitespace) -
    // this is the classic bug the raw-body requirement guards against.
    const original = Buffer.from('{ "id": 1, "note": null }');
    const signature = sign(original);
    const reserialized = Buffer.from(JSON.stringify(JSON.parse(original.toString())));
    expect(reserialized.equals(original)).toBe(false);
    expect(verifyWebhookHmac(reserialized, signature, secret)).toBe(false);
  });

  it('rejects a signature produced with the wrong secret', () => {
    const body = Buffer.from('{"id":1}');
    const wrongSignature = createHmac('sha256', 'wrong-secret').update(body).digest('base64');
    expect(verifyWebhookHmac(body, wrongSignature, secret)).toBe(false);
  });

  it('rejects a malformed (non-base64) header without throwing', () => {
    const body = Buffer.from('{"id":1}');
    expect(verifyWebhookHmac(body, 'not valid base64!!', secret)).toBe(false);
  });

  it('rejects an empty header', () => {
    const body = Buffer.from('{"id":1}');
    expect(verifyWebhookHmac(body, '', secret)).toBe(false);
  });
});
