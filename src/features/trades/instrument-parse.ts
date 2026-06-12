/**
 * Pure parsing helpers for broker tradebook imports. Everything here runs
 * client-side only — journal data never touches the platform.
 *
 * Contract-name grammar handled by `parseContractName` (NSE/BSE conventions):
 *   Monthly option  BANKNIFTY24JUN52000CE      → BANKNIFTY OPT 52000 CE
 *   Weekly option   NIFTY2461324500CE          → NIFTY OPT 24500 CE (yy=24 m=6 dd=13)
 *                   NIFTY24O1024500CE          → month letters O/N/D = Oct/Nov/Dec
 *   Futures         BANKNIFTY24JUNFUT / NIFTY24613FUT
 *   Fyers symbols   NSE:SBIN-EQ / NSE:NIFTY24JUN24500CE (exchange prefix + series)
 *   Spaced names    "NIFTY 25 JUN 2026 24500 CALL" / "BANKNIFTY 26JUN2026 52000 CE"
 *                   (Groww contract names, Dhan security names — CALL/PUT → CE/PE)
 *   Anything else   plain equity symbol
 */

export interface ParsedInstrument {
  symbol: string;
  segment: "EQ" | "FUT" | "OPT";
  strike: number | null;
  optionType: "CE" | "PE" | null;
  /** ISO yyyy-mm-dd when the name carries a full date, else null. */
  expiry: string | null;
}

const MONTHS: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};
const MONTH_RE = "JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC";

const pad2 = (n: number) => String(n).padStart(2, "0");
const isoDay = (y: number, m: number, d: number) =>
  `${y < 100 ? 2000 + y : y}-${pad2(m)}-${pad2(d)}`;

const eq = (symbol: string): ParsedInstrument => ({
  symbol,
  segment: "EQ",
  strike: null,
  optionType: null,
  expiry: null,
});

export function parseContractName(raw: string): ParsedInstrument {
  let s = raw.trim().toUpperCase().replace(/\s+/g, " ");
  if (!s) return eq(s);
  s = s.replace(/^(?:NSE|BSE|NFO|BFO|MCX|CDS):/, ""); // Fyers exchange prefix
  const series = s.match(/^([A-Z0-9&.-]+?)-(?:EQ|BE|BZ|SM|ST|A|B|T|XT)$/); // Fyers series suffix
  if (series) return eq(series[1]!);
  return s.includes(" ") ? parseSpacedName(s) : parseCompactName(s);
}

function parseCompactName(s: string): ParsedInstrument {
  // Monthly option: BANKNIFTY24JUN52000CE (decimal strikes for currency pairs)
  let m = s.match(new RegExp(`^(.+?)(\\d{2})(?:${MONTH_RE})(\\d+(?:\\.\\d+)?)(CE|PE)$`));
  if (m) {
    return {
      symbol: m[1]!,
      segment: "OPT",
      strike: Number(m[3]),
      optionType: m[4] as "CE" | "PE",
      expiry: null,
    };
  }
  // Weekly option: NIFTY2461324500CE — yy + month(1-9/O/N/D) + dd + strike
  m = s.match(/^(.+?)\d{2}[1-9OND][0-3]\d(\d+(?:\.\d+)?)(CE|PE)$/);
  if (m) {
    return {
      symbol: m[1]!,
      segment: "OPT",
      strike: Number(m[2]),
      optionType: m[3] as "CE" | "PE",
      expiry: null,
    };
  }
  // Futures: BANKNIFTY24JUNFUT / NIFTY24613FUT
  m = s.match(new RegExp(`^(.+?)\\d{2}(?:${MONTH_RE}|[1-9OND][0-3]\\d)FUT$`));
  if (m) return { symbol: m[1]!, segment: "FUT", strike: null, optionType: null, expiry: null };
  if (/FUT$/.test(s)) {
    return {
      symbol: s.replace(/\d.*FUT$/, "").replace(/FUT$/, ""),
      segment: "FUT",
      strike: null,
      optionType: null,
      expiry: null,
    };
  }
  return eq(s);
}

function parseSpacedName(s: string): ParsedInstrument {
  const tokens = s.split(" ").map((t) => (t === "CALL" ? "CE" : t === "PUT" ? "PE" : t));
  const { expiry, used } = extractExpiry(tokens);
  const numAt = (i: number) => {
    const t = tokens[i];
    return t !== undefined && !used.has(i) && /^\d+(?:\.\d+)?$/.test(t) ? Number(t) : null;
  };
  const otIdx = tokens.findIndex((t) => t === "CE" || t === "PE");
  if (otIdx > 0) {
    const strike =
      numAt(otIdx - 1) ??
      numAt(otIdx + 1) ??
      tokens.reduce<number | null>((best, _, i) => {
        const n = i === 0 ? null : numAt(i);
        return n !== null && (best === null || n > best) ? n : best;
      }, null);
    return {
      symbol: tokens[0]!,
      segment: "OPT",
      strike,
      optionType: tokens[otIdx] as "CE" | "PE",
      expiry,
    };
  }
  if (tokens.includes("FUT") || tokens.includes("FUTURES")) {
    return { symbol: tokens[0]!, segment: "FUT", strike: null, optionType: null, expiry };
  }
  return eq(s);
}

/** Finds a "26JUN2026" / "26-JUN-26" / "26 JUN 2026" expiry inside token list. */
function extractExpiry(tokens: string[]): { expiry: string | null; used: Set<number> } {
  for (let i = 0; i < tokens.length; i++) {
    const one = tokens[i]!.match(new RegExp(`^(\\d{1,2})-?(${MONTH_RE})-?(\\d{4}|\\d{2})$`));
    if (one) {
      const d = Number(one[1]);
      if (d >= 1 && d <= 31)
        return { expiry: isoDay(Number(one[3]), MONTHS[one[2]!]!, d), used: new Set([i]) };
    }
    const d = /^\d{1,2}$/.test(tokens[i]!) ? Number(tokens[i]) : 0;
    const mon = MONTHS[tokens[i + 1] ?? ""];
    const yr = /^(\d{4}|\d{2})$/.test(tokens[i + 2] ?? "") ? Number(tokens[i + 2]) : null;
    if (d >= 1 && d <= 31 && mon && yr !== null) {
      return { expiry: isoDay(yr, mon, d), used: new Set([i, i + 1, i + 2]) };
    }
  }
  return { expiry: null, used: new Set() };
}

/** "12-06-2026" / "12 Jun 2026" / "2026-06-12" → ISO yyyy-mm-dd (day-first for ambiguous). */
export function parseDateOnly(raw: string): string | null {
  const d = (raw ?? "").trim();
  if (!d) return null;
  let m = d.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = d.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[, ].*)?$/);
  if (m) {
    let day = Number(m[1]);
    let mon = Number(m[2]);
    if (mon > 12 && day <= 12) [day, mon] = [mon, day]; // tolerate MM-DD-YYYY
    return isoDay(Number(m[3]), mon, day);
  }
  m = d.match(/^(\d{1,2})[- ]([A-Za-z]{3,9})[- ,]+(\d{4}|\d{2})(?:[, ].*)?$/);
  if (m) {
    const mon = MONTHS[m[2]!.slice(0, 3).toUpperCase()];
    if (mon) return isoDay(Number(m[3]), mon, Number(m[1]));
  }
  return null;
}

/**
 * Broker date(+time) → ISO timestamp. Indian brokers write day-first dates
 * ("12-06-2026"), which `new Date()` would misread — so parse explicitly.
 */
export function parseTimestamp(dateRaw: string | undefined, timeRaw?: string): string | null {
  const d = (dateRaw ?? "").trim();
  if (!d) return null;
  const day = parseDateOnly(d);
  if (!day) {
    const native = new Date(timeRaw?.trim() ? `${d} ${timeRaw.trim()}` : d);
    return Number.isNaN(native.getTime()) ? null : native.toISOString();
  }
  // Time lives either in its own column or trails the date string.
  const trailing = d.match(/^[^ T]+[T ,]+(.+)$/)?.[1] ?? "";
  const clock = parseClock(timeRaw?.trim() || trailing);
  const out = new Date(`${day}T${clock}`);
  return Number.isNaN(out.getTime()) ? null : out.toISOString();
}

function parseClock(t: string): string {
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i);
  if (!m) return "00:00:00";
  let hh = Number(m[1]);
  const ap = m[4]?.toUpperCase();
  if (ap === "PM" && hh < 12) hh += 12;
  if (ap === "AM" && hh === 12) hh = 0;
  return `${pad2(hh)}:${m[2]}:${m[3] ?? "00"}`;
}
