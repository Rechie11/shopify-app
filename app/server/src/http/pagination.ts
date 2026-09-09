// Cursor-based pagination is opaque base64 of {id}. Offset pagination is
// not used - it breaks under concurrent writes. See ARCHITECTURE.md §6.1.
export function encodeCursor(id: number): string {
  return Buffer.from(JSON.stringify({ id }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { id: number } | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      typeof (parsed as { id: unknown }).id === 'number'
    ) {
      return { id: (parsed as { id: number }).id };
    }
    return undefined;
  } catch {
    return undefined;
  }
}
