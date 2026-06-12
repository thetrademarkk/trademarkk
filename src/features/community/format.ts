/** Pure display formatters for community surfaces (testable, no React). */

/**
 * Twitter-style compact counters: 999 → "999", 1 240 → "1.2K", 12 400 → "12.4K",
 * 124 000 → "124K", 2 400 000 → "2.4M". Never shows a trailing ".0".
 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.floor(n));
  const compact = (value: number, suffix: string) => {
    const rounded = Math.floor(value * 10) / 10; // 1.29 → 1.2 (never round up past truth)
    const text = rounded >= 100 ? String(Math.floor(rounded)) : String(rounded);
    return `${text.replace(/\.0$/, "")}${suffix}`;
  };
  if (n < 1_000_000) return compact(n / 1000, "K");
  return compact(n / 1_000_000, "M");
}

/**
 * Compact label for "Commented on <post>" context rows: the post title when it
 * has one, otherwise the start of the body. Trims mid-word cuts and never
 * exceeds `max` characters (plus the ellipsis).
 */
export function postContextLabel(title: string | null, body: string, max = 64): string {
  const source = (title ?? "").trim() || body.trim().replace(/\s+/g, " ");
  if (!source) return "a post";
  if (source.length <= max) return source;
  return `${source.slice(0, max).trimEnd()}…`;
}

/**
 * Absolute timestamp for the post detail header — readers landing from a
 * shared link need the real date, not "3w ago". Example: "12 Jun 2026, 7:05 pm".
 */
export function formatPostDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const time = d
    .toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
    .toLowerCase();
  return `${date}, ${time}`;
}
