/**
 * SQL identifier validation. Column/table names sometimes come from untrusted
 * sources (backup JSON files, external database schemas during migration).
 * Values are always parameterized; identifiers must be allowlist-validated.
 */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertSafeIdentifiers(names: string[]): string[] {
  for (const name of names) {
    if (!SAFE_IDENTIFIER.test(name)) {
      throw new Error(`Unsafe SQL identifier rejected: ${JSON.stringify(name.slice(0, 50))}`);
    }
  }
  return names;
}
