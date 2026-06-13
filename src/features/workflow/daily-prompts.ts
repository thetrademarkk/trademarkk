/**
 * Structured daily-journal prompts ("best trade? biggest mistake? emotional
 * state? tomorrow's watchlist?"). These persist into the EXISTING journal entry
 * for a date — no schema change. We serialize the four answers into a fenced
 * block at the top of `postmarket_review` so they round-trip cleanly and any
 * free-form review text the user already wrote is preserved below the block.
 */

export interface DailyPrompts {
  bestTrade: string;
  biggestMistake: string;
  emotionalState: string;
  watchlist: string;
}

export const EMPTY_PROMPTS: DailyPrompts = {
  bestTrade: "",
  biggestMistake: "",
  emotionalState: "",
  watchlist: "",
};

/** UI metadata for rendering the widget — keep order stable for serialization. */
export const PROMPT_FIELDS: { key: keyof DailyPrompts; label: string; placeholder: string }[] = [
  {
    key: "bestTrade",
    label: "Best trade today",
    placeholder: "Which trade did you execute best, and why?",
  },
  {
    key: "biggestMistake",
    label: "Biggest mistake",
    placeholder: "What would you do differently?",
  },
  {
    key: "emotionalState",
    label: "Emotional state",
    placeholder: "Calm? Anxious? Revenge-trading urges?",
  },
  {
    key: "watchlist",
    label: "Tomorrow's watchlist",
    placeholder: "Symbols, levels and setups to watch.",
  },
];

const BEGIN = "<!-- tm:daily-prompts";
const END = "tm:end -->";
// Stored as `KEY: value` lines inside the fenced block. Values are single-line
// in storage (newlines escaped) so the block is trivially parseable.
const KEY_LINE: Record<keyof DailyPrompts, string> = {
  bestTrade: "BEST",
  biggestMistake: "MISTAKE",
  emotionalState: "EMOTION",
  watchlist: "WATCHLIST",
};
const LINE_KEY: Record<string, keyof DailyPrompts> = Object.fromEntries(
  Object.entries(KEY_LINE).map(([k, v]) => [v, k as keyof DailyPrompts])
) as Record<string, keyof DailyPrompts>;

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
const unesc = (s: string) => s.replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
const isEmpty = (p: DailyPrompts) => PROMPT_FIELDS.every((f) => !p[f.key].trim());

/** True if the text carries a serialized prompts block. */
export function hasPromptsBlock(review: string | null | undefined): boolean {
  return typeof review === "string" && review.includes(BEGIN) && review.includes(END);
}

/**
 * Pulls the structured prompts out of a stored `postmarket_review`, returning
 * the parsed answers plus the free-form text that lived outside the block.
 * Missing / malformed block → empty prompts and the whole string as free text.
 */
export function parsePrompts(review: string | null | undefined): {
  prompts: DailyPrompts;
  freeText: string;
} {
  const text = review ?? "";
  const start = text.indexOf(BEGIN);
  const endIdx = text.indexOf(END);
  if (start === -1 || endIdx === -1 || endIdx < start) {
    return { prompts: { ...EMPTY_PROMPTS }, freeText: text.trim() };
  }
  const block = text.slice(start + BEGIN.length, endIdx);
  const prompts: DailyPrompts = { ...EMPTY_PROMPTS };
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*([A-Z]+):\s?(.*)$/);
    if (!m) continue;
    const key = LINE_KEY[m[1] ?? ""];
    if (key) prompts[key] = unesc(m[2] ?? "");
  }
  const before = text.slice(0, start);
  const after = text.slice(endIdx + END.length);
  const freeText = `${before}${after}`.trim();
  return { prompts, freeText };
}

/**
 * Serializes structured prompts back into a `postmarket_review` string,
 * preserving any free-form text after the block. When every prompt is blank the
 * block is dropped entirely so we never persist an empty marker.
 */
export function serializePrompts(prompts: DailyPrompts, freeText: string): string {
  const free = (freeText ?? "").trim();
  if (isEmpty(prompts)) return free;
  const lines = PROMPT_FIELDS.map((f) => `${KEY_LINE[f.key]}: ${esc(prompts[f.key].trim())}`);
  const block = `${BEGIN}\n${lines.join("\n")}\n${END}`;
  return free ? `${block}\n\n${free}` : block;
}
