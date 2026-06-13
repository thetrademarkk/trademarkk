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
 *   Commodity (MCX) MCX:CRUDEOIL24JUNFUT / CRUDEOIL / GOLD24JUN72000CE → COMM
 *   Currency (CDS)  USDINR24JUN83.5CE / EURINR / NSE:USDINR24JUNFUT    → CDS
 *   Anything else   plain equity symbol
 *
 * Commodity / currency classification (SEG-03): an `MCX:` prefix, a CDS exchange
 * prefix, or a recognised commodity contract base (CRUDEOIL/GOLD/SILVER/…) maps
 * the segment to COMM; the four INR currency pairs (USDINR/EURINR/GBPINR/JPYINR,
 * incl. decimal strikes) map to CDS. Strike / option-type / expiry parsing is
 * preserved — a COMM or CDS option keeps its strike+CE/PE, a future stays a
 * carry contract in its own segment rather than falling back to EQ/FUT/OPT.
 */

export interface ParsedInstrument {
  symbol: string;
  segment: "EQ" | "FUT" | "OPT" | "COMM" | "CDS";
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

/** The four NSE/BSE INR currency pairs (CDS segment). */
const CURRENCY_PAIRS = new Set(["USDINR", "EURINR", "GBPINR", "JPYINR"]);

/**
 * MCX commodity contract bases. A symbol whose base matches one of these (e.g.
 * CRUDEOIL, GOLDM, SILVERMIC) is a commodity even without an MCX: prefix —
 * Dhan/Groww/Angel security names omit the exchange tag. Matched by prefix so
 * mini/micro variants (GOLDM, GOLDPETAL, SILVERMIC, CRUDEOILM) classify too.
 */
const COMMODITY_BASES = [
  "CRUDEOIL",
  "NATURALGAS",
  "NATGAS",
  "GOLD",
  "SILVER",
  "COPPER",
  "ZINC",
  "ALUMINIUM",
  "ALUMINI",
  "LEAD",
  "NICKEL",
  "MENTHAOIL",
  "COTTON",
  "CARDAMOM",
  "KAPAS",
];

/** Agri commodities (CTT-exempt) — informational; charge engine takes agri flag separately. */
const isCommodityBase = (sym: string) => COMMODITY_BASES.some((b) => sym.startsWith(b));

/**
 * Reclassifies an equity/F&O parse into COMM (MCX commodity) or CDS (currency)
 * when the exchange prefix or symbol base says so, preserving strike/optionType
 * /expiry. `exchange` is the stripped prefix (MCX/CDS/NSE/…) or "".
 */
function reclassifySegment(p: ParsedInstrument, exchange: string): ParsedInstrument {
  const isCurrency = exchange === "CDS" || CURRENCY_PAIRS.has(p.symbol);
  const isCommodity = exchange === "MCX" || isCommodityBase(p.symbol);
  if (!isCurrency && !isCommodity) return p;
  // Currency wins only if the base is an actual INR pair OR the prefix is CDS and
  // it isn't a known commodity (avoids an MCX symbol that merely contains "INR").
  const segment: ParsedInstrument["segment"] = isCurrency && !isCommodity ? "CDS" : "COMM";
  return { ...p, segment };
}

export function parseContractName(raw: string): ParsedInstrument {
  let s = raw.trim().toUpperCase().replace(/\s+/g, " ");
  if (!s) return eq(s);
  const prefix = s.match(/^(NSE|BSE|NFO|BFO|MCX|CDS|BCD|NCO):/); // Fyers/exchange prefix
  const exchange = prefix?.[1] ?? "";
  s = s.replace(/^(?:NSE|BSE|NFO|BFO|MCX|CDS|BCD|NCO):/, "");
  const series = s.match(/^([A-Z0-9&.-]+?)-(?:EQ|BE|BZ|SM|ST|A|B|T|XT)$/); // Fyers series suffix
  if (series) return reclassifySegment(eq(series[1]!), exchange);
  const parsed = s.includes(" ") ? parseSpacedName(s) : parseCompactName(s);
  return reclassifySegment(parsed, exchange);
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

/**
 * SEBI Rule-3 agri-commodity classification (SEG-CHG). Commodities on the
 * notified agricultural list are EXEMPT from CTT (and carry the ₹1/crore SEBI
 * slab); everything else on the commodity exchanges (bullion, energy, base
 * metals, and PROCESSED agri products) pays CTT.
 *
 * Matched by NORMALISED SYMBOL BASE against an explicit set — NOT a substring —
 * because the processed derivative of an exempt crop is itself non-exempt:
 * GUARSEED is agri-exempt but GUARGUM (the processed gum) is NOT; cottonseed
 * oilcake (COCUDAKL) and refined/processed edible oils are NOT; the AGRIDEX
 * index is NOT (it pays CTT 0.01%). So a bare `.startsWith("GUAR")` would
 * wrongly exempt Guar Gum — we require a whole base-token match instead.
 */
const AGRI_EXEMPT = new Set<string>([
  // pulses / grains
  "CHANA",
  "WHEAT",
  "BARLEY",
  "MAIZE",
  "MAIZERABI",
  "MAIZEKHARIF",
  "BAJRA",
  "PADDY",
  "RICE",
  "MOONG",
  "TUR",
  "URAD",
  "MASUR",
  // oilseeds (raw seeds — exempt; processed oils/cakes are NOT, see below)
  "SOYBEAN",
  "SOYABEAN",
  "MUSTARDSEED",
  "RMSEED",
  "MUSTARD",
  "CASTORSEED",
  "CASTOR",
  "GROUNDNUT",
  "SESAME",
  "TIL",
  "SUNFLOWER",
  "COTTONSEED",
  "GUARSEED",
  "GUAR",
  // spices
  "JEERA",
  "DHANIYA",
  "CORIANDER",
  "TURMERIC",
  "HALDI",
  "CARDAMOM",
  "PEPPER",
  "BLACKPEPPER",
  "CHILLI",
  "REDCHILLI",
  "MENTHAOIL",
  "MENTHA",
  // fibres & plantation
  "COTTON",
  "KAPAS",
  "COTTONCNDY",
  "JUTE",
  "RUBBER",
  // sweeteners / others
  "SUGAR",
  "SUGARM",
  "SUGARS",
  "GUR",
  "JAGGERY",
  "CASHEW",
  "ALMOND",
  "COCOA",
  "COFFEE",
  "POTATO",
  "ONION",
  "ISABGUL",
]);

/**
 * Processed agri products and indices that LOOK agri but are NON-exempt (CTT
 * applies). Checked first so e.g. GUARGUM never matches the GUAR seed entry.
 */
const AGRI_PROCESSED_EXCEPTIONS = new Set<string>([
  "GUARGUM", // processed gum — non-agri (CTT applies)
  "COCUDAKL", // cottonseed oilcake — processed
  "COCUDAKLA",
  "SOYAOIL",
  "SOYOIL",
  "REFSOYOIL",
  "CPO", // crude palm oil — processed edible oil
  "PALMOIL",
  "PALMOLEIN",
  "MUSTARDOIL",
  "CASTOROIL",
  "AGRIDEX", // NCDEX agri index — pays CTT 0.01%
]);

/** A commodity symbol's base token (strip exchange prefix + contract suffix, uppercase). */
function commodityBase(sym: string): string {
  return (
    sym
      .trim()
      .toUpperCase()
      .replace(/^(?:MCX|NCDEX|NCO|NSE|BSE):/, "")
      // drop a trailing yy-mon (24JUN…) / numeric-date / FUT tail used by contract names
      .replace(/\d.*$/, "")
  );
}

/**
 * True when a commodity (segment === "COMM") is a SEBI Rule-3 agri commodity
 * exempt from CTT. Processed products (Guar Gum, oilcakes, refined oils) and the
 * AGRIDEX index are NON-agri even though their base looks agricultural.
 */
export function classifyAgriCommodity(symbol: string): boolean {
  const base = commodityBase(symbol);
  if (!base) return false;
  if (AGRI_PROCESSED_EXCEPTIONS.has(base)) return false;
  return AGRI_EXEMPT.has(base);
}
