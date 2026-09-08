import { describe, expect, it } from 'vitest';
import { isMysqlErrorCode } from '../../src/db/errors.js';

describe('isMysqlErrorCode', () => {
  it('matches a code on the error itself', () => {
    const err = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
    expect(isMysqlErrorCode(err, 'ER_DUP_ENTRY')).toBe(true);
  });

  it('matches a code nested under .cause, as drizzle-orm wraps driver errors', () => {
    const driverErr = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
    const wrapped = new Error('Failed query', { cause: driverErr });
    expect(isMysqlErrorCode(wrapped, 'ER_DUP_ENTRY')).toBe(true);
  });

  it('returns false for an unrelated error code', () => {
    const err = Object.assign(new Error('locked'), { code: 'ER_LOCK_WAIT_TIMEOUT' });
    expect(isMysqlErrorCode(err, 'ER_DUP_ENTRY')).toBe(false);
  });

  it('returns false for a plain error with no code anywhere in the cause chain', () => {
    expect(isMysqlErrorCode(new Error('plain'), 'ER_DUP_ENTRY')).toBe(false);
  });

  it('does not loop forever on a self-referential cause chain', () => {
    const err = new Error('a');
    // Not realistic, but proves the depth cap actually terminates.
    (err as { cause?: unknown }).cause = err;
    expect(isMysqlErrorCode(err, 'ER_DUP_ENTRY')).toBe(false);
  });
});
