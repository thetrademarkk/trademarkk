/**
 * Pure, DOM-free, framework-free content-quality heuristics for community posts.
 *
 * Goal: keep the feed high-quality and SEBI-sane WITHOUT being heavy-handed.
 * Genuine traders sharing their reasoning must NEVER be blocked — the only hard
 * block is the egregious paid-group / solicitation spam. Everything else is a
 * NON-blocking soft flag (a composer nudge + a `quality_flag` on the row for
 * later moderation review) or a clear low-effort rejection.
 *
 * Every rule here is a pure function with documented, conservative thresholds,
 * tuned to minimize FALSE POSITIVES. The server (createPost / editPost) wires
 * them in; the composer mirrors the soft warning client-side.
 *
 * Two surfaces consume this:
 *   - the server gate `evaluatePostQuality()` (authoritative, runs on create/edit);
 *   - the composer's live `previewPostQuality()` nudge (advisory, no near-dup check
 *     since the client has no recent-post corpus).
 */

/* ── Verdict types ─────────────────────────────────────────────────────────── */

/**
 * The reason a post was soft-flagged for moderation review, stored verbatim in
 * `posts.quality_flag`. NULL on the column = clean. Kept as a small, stable
 * enum so the (future) moderation queue can group/filter by it.
 */
export type QualityFlagReason = "tip" | "solicitation" | "all-caps" | "low-effort";

/** A hard-block decision carries a user-facing message; a soft-flag carries a nudge. */
export interface QualityVerdict {
  /**
   * - "allow": post as-is, no flag.
   * - "flag": post is allowed but tagged with `flag` for moderation review; the
   *   composer shows `warning` as a non-blocking nudge.
   * - "block": reject with `message` (egregious spam / solicitation / low-effort).
   */
  decision: "allow" | "flag" | "block";
  /** Set when decision === "flag" — the value to persist in `quality_flag`. */
  flag: QualityFlagReason | null;
  /** Set when decision === "block" — the 4xx error message for the API. */
  message: string | null;
  /** Set when decision === "flag" — the soft composer nudge. */
  warning: string | null;
}

const ALLOW: QualityVerdict = { decision: "allow", flag: null, message: null, warning: null };

const flag = (flag: QualityFlagReason, warning: string): QualityVerdict => ({
  decision: "flag",
  flag,
  message: null,
  warning,
});

const block = (message: string): QualityVerdict => ({
  decision: "block",
  flag: null,
  message,
  warning: null,
});

/* ── Shared normalization ──────────────────────────────────────────────────── */

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

/** Strips URLs out of a body so link text never inflates letter/word heuristics. */
function stripUrls(text: string): string {
  return text.replace(URL_RE, " ");
}

/** Count of links in a body (http/https). */
export function countLinks(text: string): number {
  return text.match(URL_RE)?.length ?? 0;
}

/**
 * Letters only (a-z, plus Devanagari range so Hindi/Hinglish posts aren't
 * mis-measured as "no letters"). Used for the all-caps ratio so digits,
 * punctuation, $TICKERS and emoji don't dominate the denominator.
 */
const LATIN_LETTERS = /[a-z]/gi;

/* ── 1. Anti-tip / pump nudge (the SEBI-sanity core) ───────────────────────── */

/**
 * EGREGIOUS solicitation — the ONLY thing we hard-block. These are unambiguous
 * "join my paid group / DM for calls" spam patterns, not genuine analysis. We
 * require a *solicitation verb/context* near a *channel* so that merely
 * MENTIONING telegram ("I saw this on a telegram group, here's why it's wrong")
 * does NOT trip it.
 */
const SOLICITATION_PATTERNS: RegExp[] = [
  // "join my/our (paid|premium|vip) (telegram|whatsapp|channel|group)"
  /\bjoin\b[^.\n]{0,40}\b(paid|premium|vip|private)\b[^.\n]{0,30}\b(telegram|whatsapp|channel|group|signals?)\b/i,
  /\bjoin\b[^.\n]{0,30}\b(my|our)\b[^.\n]{0,30}\b(telegram|whatsapp)\b[^.\n]{0,30}\b(channel|group|signals?)\b/i,
  // "DM/ping/message me for (calls|tips|signals|profit)"
  /\b(dm|pm|ping|message|whatsapp|inbox|contact)\b[^.\n]{0,20}\b(me|us)\b[^.\n]{0,30}\bfor\b[^.\n]{0,30}\b(calls?|tips?|signals?|profit|targets?|guaranteed|sure[\s-]?shot|multibagger)\b/i,
  // explicit paid-subscription pitch with a contact channel
  /\b(paid|premium|vip)\b[^.\n]{0,20}\b(group|channel|membership|subscription|service)\b[^.\n]{0,40}\b(telegram|whatsapp|dm|join|@|t\.me|wa\.me|\d{4,})\b/i,
  // a bare telegram/whatsapp invite link is almost always solicitation
  /\b(t\.me\/|wa\.me\/|chat\.whatsapp\.com\/|telegram\.me\/)/i,
  // "@handle on telegram" style invite + a calls/tips offer
  /\b(telegram|whatsapp)\b[^.\n]{0,15}@\w+[^.\n]{0,30}\b(calls?|tips?|signals?|profit)\b/i,
];

/**
 * STRONG tip / assured-return / call language — ALWAYS soft-flags (never blocks,
 * but the analysis-hint downgrade does NOT apply). These read unambiguously like
 * a promise or an unsolicited buy/sell call, not reasoning: a genuine reflective
 * post would not say "guaranteed profit" or "BUY X TARGET n SL n".
 */
const STRONG_TIP_PATTERNS: RegExp[] = [
  // assured-return / guarantee language
  /\b(guaranteed?|assured|100%|fixed)\b[^.\n]{0,20}\b(profit|return|returns?|gain|income|tip|call)\b/i,
  /\b(sure[\s-]?shot|jackpot|multibagger|confirm(ed)?\s+(profit|tip|call)|risk[\s-]?free)\b/i,
  /\bdouble\b[^.\n]{0,15}\b(your\s+)?(money|capital|investment)\b/i,
  // imperative buy/sell call with an explicit target AND a stoploss — the
  // classic "BUY X TARGET n SL n" tip shape (an unsolicited call, not analysis).
  /\b(buy|sell|short|long)\b[^.\n]{0,40}\btarget\b[^.\n]{0,25}\b(sl|stop[\s-]?loss|stoploss)\b/i,
  /\b(buy|sell|short|long)\b[^.\n]{0,40}\b(sl|stop[\s-]?loss|stoploss)\b[^.\n]{0,25}\btarget\b/i,
  // "X% profit/return" claim
  /\b\d{2,}\s?%[^.\n]{0,25}\b(profit|return|returns?|gain)\b/i,
];

/**
 * SOFT tip language — "intraday/today's tip", "tip of the day" — which usually
 * signals a call, BUT can legitimately appear in a reflective post ("I stopped
 * following intraday tips and started journaling"). These flag UNLESS the body
 * also carries strong analysis hints (see {@link ANALYSIS_HINTS}) — that
 * downgrade keeps the gate conservative and false-positive-shy.
 */
const SOFT_TIP_PATTERNS: RegExp[] = [
  /\b(intraday|today'?s?|free|best|hot)\b[^.\n]{0,15}\b(tips?|calls?)\b/i,
  /\b(tip|call)\b[^.\n]{0,10}\bof\s+the\s+day\b/i,
];

/**
 * Genuine-analysis guard: phrases that signal the author is reasoning, not
 * issuing a call. When the body clearly reads as analysis a SOFT tip match is
 * DOWNGRADED to clean (the strong patterns above are never downgraded). This
 * lets a thoughtful post that merely references "tips" pass while still flagging
 * a bare "free intraday calls below".
 */
const ANALYSIS_HINTS: RegExp[] = [
  /\b(i think|i feel|in my view|imo|my (view|take|reasoning|thesis|plan)|because|since|the reason|risk[\s:-]|i'?m watching|i expect|could|might|may|seems|looks like|setup|backtest|journal(ed|ing|s)?|i traded|i bought|i sold|i exited|lesson|learn(ed|ing|t)?|stopped following)\b/i,
];

/** True when the body carries at least one genuine-analysis hint. */
function readsAsAnalysis(text: string): boolean {
  return ANALYSIS_HINTS.some((re) => re.test(text));
}

/** True when the body matches the rigid imperative call shape (buy/sell + target + SL). */
function isImperativeCall(text: string): boolean {
  return (
    /\b(buy|sell|short|long)\b[^.\n]{0,40}\btarget\b[^.\n]{0,25}\b(sl|stop[\s-]?loss|stoploss)\b/i.test(
      text
    ) ||
    /\b(buy|sell|short|long)\b[^.\n]{0,40}\b(sl|stop[\s-]?loss|stoploss)\b[^.\n]{0,25}\btarget\b/i.test(
      text
    )
  );
}

const SOLICITATION_WARNING =
  "This reads like paid-group / signal solicitation. TradeMarkk is for educational discussion only — no tips, calls, or promotion of paid groups.";

const TIP_WARNING =
  "Educational discussion only — no tips, targets, or calls. Reframe this as your reasoning or analysis.";

/**
 * Classifies tip/pump/solicitation language.
 *  - egregious solicitation → BLOCK;
 *  - tip/call/assured-return language → soft FLAG ("tip");
 *  - clean → null.
 */
export function classifyTipLanguage(rawBody: string): QualityVerdict | null {
  const body = rawBody;
  // Hard block: unambiguous paid-group / signal solicitation.
  if (SOLICITATION_PATTERNS.some((re) => re.test(body))) {
    return block(SOLICITATION_WARNING);
  }
  // Strong soft-flag: assured-return / guarantee / rigid imperative call — these
  // always flag (the analysis-hint downgrade does NOT apply to them).
  if (STRONG_TIP_PATTERNS.some((re) => re.test(body)) || isImperativeCall(body)) {
    return flag("tip", TIP_WARNING);
  }
  // Soft tip language ("intraday tips", "tip of the day") flags ONLY when the
  // body doesn't otherwise read as genuine analysis — minimizes false positives.
  if (SOFT_TIP_PATTERNS.some((re) => re.test(body)) && !readsAsAnalysis(body)) {
    return flag("tip", TIP_WARNING);
  }
  return null;
}

/* ── 2. Low-effort / spam gate ─────────────────────────────────────────────── */

/** Min letters/word-ish content after stripping links — below this is empty noise. */
const MIN_MEANINGFUL_CHARS = 5;
/** All-caps gate only applies once a body is long enough to be a "wall". */
const ALLCAPS_MIN_LETTERS = 25;
/** Fraction of letters that are uppercase, above which a long body is a caps-wall. */
const ALLCAPS_RATIO = 0.8;
/** A single char repeated this many times in a row is keyboard-mashing. */
const MAX_CHAR_RUN = 12;
/** Link-only / link-heavy guard: links allowed, but not as the WHOLE post. */
const MIN_NON_LINK_CHARS_WITH_LINK = 15;

const LOW_EFFORT_EMPTY =
  "Add a little more — share the idea, the reasoning, or the question so others can engage.";
const ALLCAPS_BLOCK = "Please don't post in all caps — rewrite in normal case so it's readable.";
const REPEAT_BLOCK = "That looks like keyboard-mashing — please write a real post.";
const LINK_ONLY_BLOCK =
  "Add some context with your link — a bare link with no explanation isn't allowed.";

/** Longest run of a single repeated character (case-insensitive). */
export function longestCharRun(text: string): number {
  let max = 0;
  let run = 0;
  let prev = "";
  for (const ch of text.toLowerCase()) {
    if (ch === prev) {
      run += 1;
    } else {
      run = 1;
      prev = ch;
    }
    if (run > max) max = run;
  }
  return max;
}

/** Uppercase-letter ratio over Latin letters only (0..1); 0 when no letters. */
export function upperCaseRatio(text: string): number {
  const letters = text.match(LATIN_LETTERS) ?? [];
  if (letters.length === 0) return 0;
  const upper = letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length;
  return upper / letters.length;
}

/**
 * Detects low-effort / spam shapes that we HARD-reject with a clear message:
 *  - empty / near-empty bodies (after stripping links/whitespace);
 *  - all-caps walls (long bodies that are ≥80% uppercase);
 *  - excessive repeated characters (keyboard-mashing);
 *  - link-only / link-dominated posts (a link with almost no other content).
 * Returns a block verdict or null.
 */
export function classifyLowEffort(rawBody: string): QualityVerdict | null {
  const body = rawBody.trim();
  const linkCount = countLinks(body);
  const withoutUrls = stripUrls(body).trim();

  // Near-empty (ignoring links): "....", "ok", a lone emoji, whitespace.
  const meaningful = withoutUrls.replace(/\s+/g, "");
  if (linkCount === 0 && meaningful.length < MIN_MEANINGFUL_CHARS) {
    return block(LOW_EFFORT_EMPTY);
  }

  // Link-only / link-dominated: there IS a link but almost nothing else.
  if (linkCount > 0 && withoutUrls.replace(/\s+/g, "").length < MIN_NON_LINK_CHARS_WITH_LINK) {
    return block(LINK_ONLY_BLOCK);
  }

  // Keyboard-mashing: a single character repeated absurdly (over links-stripped).
  if (longestCharRun(withoutUrls) > MAX_CHAR_RUN) {
    return block(REPEAT_BLOCK);
  }

  return null;
}

/**
 * All-caps wall — a SOFT flag, not a block (some genuine excited posts shout a
 * bit). Only a long, overwhelmingly-uppercase body trips it; short emphatic
 * lines ("HUGE day, NIFTY ripped") never do. Returns a flag verdict or null.
 */
export function classifyAllCaps(rawBody: string): QualityVerdict | null {
  const withoutUrls = stripUrls(rawBody);
  const letterCount = (withoutUrls.match(LATIN_LETTERS) ?? []).length;
  if (letterCount >= ALLCAPS_MIN_LETTERS && upperCaseRatio(withoutUrls) >= ALLCAPS_RATIO) {
    return flag("all-caps", ALLCAPS_BLOCK);
  }
  return null;
}

/* ── 3. Near-duplicate gate ────────────────────────────────────────────────── */

/** How recent a prior post must be to count as a near-duplicate repost (24h). */
export const NEAR_DUP_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Jaccard similarity (token sets) at/above which two bodies are "near-identical". */
export const NEAR_DUP_SIMILARITY = 0.85;
/** Below this token count we compare on exact normalized equality only (too short for Jaccard). */
const NEAR_DUP_MIN_TOKENS = 4;

const NEAR_DUP_BLOCK =
  "You just posted something almost identical — edit or add to your earlier post instead of reposting.";

/** Normalizes a body for duplicate comparison: lowercase, URL-stripped, collapsed whitespace. */
export function normalizeForDup(text: string): string {
  return stripUrls(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Token set of a normalized body. */
function tokenSet(text: string): Set<string> {
  return new Set(normalizeForDup(text).split(" ").filter(Boolean));
}

/** Jaccard similarity of two token sets (0..1); 1 for two empty sets. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Returns true when `candidate` is a near-duplicate of any `recent` body. Short
 * bodies (< {@link NEAR_DUP_MIN_TOKENS} tokens) only match on EXACT normalized
 * equality (Jaccard over tiny token sets is too coarse to be safe). Longer
 * bodies use a Jaccard threshold. Empty candidates never match (the low-effort
 * gate handles those).
 */
export function isNearDuplicate(candidate: string, recent: readonly string[]): boolean {
  const candNorm = normalizeForDup(candidate);
  if (!candNorm) return false;
  const candTokens = tokenSet(candidate);
  for (const prior of recent) {
    const priorNorm = normalizeForDup(prior);
    if (!priorNorm) continue;
    if (candNorm === priorNorm) return true;
    if (candTokens.size < NEAR_DUP_MIN_TOKENS) continue; // too short for fuzzy match
    if (jaccard(candTokens, tokenSet(prior)) >= NEAR_DUP_SIMILARITY) return true;
  }
  return false;
}

/* ── Composite evaluation ──────────────────────────────────────────────────── */

/**
 * The composer's advisory preview: runs the soft-flag heuristics ONLY (no
 * hard-block-as-error, no near-dup — the client has no recent corpus). Returns
 * a warning string to nudge the author, or null when the draft reads clean.
 * Solicitation still surfaces its (stronger) warning so the author self-corrects
 * before the server rejects it.
 */
export function previewPostQuality(body: string): string | null {
  const tip = classifyTipLanguage(body);
  if (tip?.decision === "block") return tip.message; // solicitation — warn early
  if (tip?.decision === "flag") return tip.warning;
  const caps = classifyAllCaps(body);
  if (caps) return caps.warning;
  return null;
}

export interface EvaluatePostQualityInput {
  body: string;
  /** Recent bodies by the SAME author within the dup window (for near-dup detection). */
  recentBodies?: readonly string[];
}

/**
 * The authoritative server gate. Order of precedence:
 *   1. low-effort HARD blocks (empty/link-only/keyboard-mash) — clearest signal;
 *   2. tip/solicitation — solicitation BLOCKS, a tip soft-FLAGS;
 *   3. near-duplicate repost — BLOCKS;
 *   4. all-caps wall — soft FLAG;
 *   5. otherwise allow.
 *
 * A BLOCK short-circuits (the post never lands). A FLAG is recorded but the post
 * is allowed. When multiple soft flags apply, tip wins over all-caps (it's the
 * more important moderation signal).
 */
export function evaluatePostQuality(input: EvaluatePostQualityInput): QualityVerdict {
  const { body, recentBodies = [] } = input;

  const lowEffort = classifyLowEffort(body);
  if (lowEffort) return lowEffort;

  const tip = classifyTipLanguage(body);
  if (tip?.decision === "block") return tip;

  if (isNearDuplicate(body, recentBodies)) {
    return block(NEAR_DUP_BLOCK);
  }

  if (tip?.decision === "flag") return tip;

  const caps = classifyAllCaps(body);
  if (caps) return caps;

  return ALLOW;
}
