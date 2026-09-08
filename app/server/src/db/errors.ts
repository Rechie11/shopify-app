// drizzle-orm wraps the underlying mysql2 driver error in a
// DrizzleQueryError, with the real error (carrying .code) on .cause -
// not on the thrown error itself. Checking err.code directly silently
// never matches, so a real duplicate-key replay looks like an
// unhandled 500 instead of the idempotent no-op it should be.
export function isMysqlErrorCode(err: unknown, code: string): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (
      typeof current === 'object' &&
      'code' in current &&
      (current as { code?: string }).code === code
    ) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}
