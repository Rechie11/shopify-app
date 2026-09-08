import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken } from '../../src/shopify/crypto.js';

describe('token encryption', () => {
  const key = randomBytes(32);

  it('round-trips a plaintext token', () => {
    const plaintext = 'shpat_abcdef1234567890';
    const encrypted = encryptToken(plaintext, key);
    expect(decryptToken(encrypted, key)).toBe(plaintext);
  });

  it('produces a different ciphertext and iv each time', () => {
    const a = encryptToken('same-token', key);
    const b = encryptToken('same-token', key);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('fails to decrypt with the wrong key', () => {
    const encrypted = encryptToken('secret', key);
    const wrongKey = randomBytes(32);
    expect(() => decryptToken(encrypted, wrongKey)).toThrow();
  });

  it('fails to decrypt if the tag has been tampered with', () => {
    const encrypted = encryptToken('secret', key);
    encrypted.tag[0] = (encrypted.tag[0] ?? 0) ^ 0xff;
    expect(() => decryptToken(encrypted, key)).toThrow();
  });
});
