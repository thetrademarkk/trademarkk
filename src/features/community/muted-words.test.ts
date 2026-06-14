import { describe, expect, it } from "vitest";
import {
  addMuteEntry,
  candidateText,
  describeMuteEntry,
  entryMatchesText,
  isMuted,
  isMuteExpired,
  MAX_MUTED_ENTRIES,
  MAX_TERM_LENGTH,
  matchesMuted,
  type MuteEntry,
  normalizeMuteTerm,
  parseMutedWords,
  removeMuteEntry,
  sanitizeMuteEntry,
  sanitizeMuteList,
  serializeMutedWords,
} from "./muted-words";

const T0 = Date.parse("2026-06-14T00:00:00.000Z");

/** Quick entry builder. */
const e = (
  term: string,
  mode: MuteEntry["mode"] = "substring",
  extra: Partial<MuteEntry> = {}
): MuteEntry => ({
  term,
  mode,
  ...extra,
});

describe("normalizeMuteTerm", () => {
  it("trims substring/word terms verbatim (case preserved for the match-time flag)", () => {
    expect(normalizeMuteTerm("  Scam  ", "substring")).toBe("Scam");
    expect(normalizeMuteTerm("FOMO", "word")).toBe("FOMO");
  });
  it("strips the $ sigil and uppercases cashtags", () => {
    expect(normalizeMuteTerm("$reliance", "cashtag")).toBe("RELIANCE");
    expect(normalizeMuteTerm("nifty", "cashtag")).toBe("NIFTY");
    expect(normalizeMuteTerm("$$bajaj-auto", "cashtag")).toBe("BAJAJ-AUTO");
    expect(normalizeMuteTerm("m&m", "cashtag")).toBe("M&M");
  });
  it("strips the # sigil and lowercases hashtags", () => {
    expect(normalizeMuteTerm("#Options", "hashtag")).toBe("options");
    expect(normalizeMuteTerm("bank-nifty", "hashtag")).toBe("bank-nifty");
  });
  it("rejects empty terms", () => {
    expect(normalizeMuteTerm("   ", "substring")).toBeNull();
    expect(normalizeMuteTerm("$", "cashtag")).toBeNull();
    expect(normalizeMuteTerm("#", "hashtag")).toBeNull();
  });
  it("rejects over-long terms", () => {
    expect(normalizeMuteTerm("a".repeat(MAX_TERM_LENGTH + 1), "substring")).toBeNull();
    expect(normalizeMuteTerm("a".repeat(MAX_TERM_LENGTH), "substring")).not.toBeNull();
  });
});

describe("entryMatchesText — substring mode", () => {
  it("matches anywhere, case-insensitive by default", () => {
    expect(entryMatchesText(e("scam"), "This is a SCAM!")).toBe(true);
    expect(entryMatchesText(e("scam"), "scammers everywhere")).toBe(true); // substring is blunt
    expect(entryMatchesText(e("scam"), "totally legit")).toBe(false);
  });
  it("respects case-sensitivity when opted in", () => {
    expect(entryMatchesText(e("Scam", "substring", { caseSensitive: true }), "this scam")).toBe(
      false
    );
    expect(entryMatchesText(e("Scam", "substring", { caseSensitive: true }), "a Scam here")).toBe(
      true
    );
  });
});

describe("entryMatchesText — word mode boundary safety", () => {
  it("does NOT match a term inside a larger word (asset/ass)", () => {
    expect(entryMatchesText(e("ass", "word"), "this is an asset")).toBe(false);
    expect(entryMatchesText(e("ass", "word"), "passing the test")).toBe(false);
    expect(entryMatchesText(e("ass", "word"), "what an ass move")).toBe(true);
  });
  it("matches whole words regardless of surrounding punctuation", () => {
    expect(entryMatchesText(e("loss", "word"), "huge loss!")).toBe(true);
    expect(entryMatchesText(e("loss", "word"), "(loss)")).toBe(true);
    expect(entryMatchesText(e("loss", "word"), "lossless")).toBe(false);
    expect(entryMatchesText(e("loss", "word"), "stop-loss")).toBe(true); // hyphen is a boundary
  });
  it("matches at the very start and end of the text", () => {
    expect(entryMatchesText(e("nifty", "word"), "nifty is up")).toBe(true);
    expect(entryMatchesText(e("nifty", "word"), "buy nifty")).toBe(true);
  });
  it("honors case-sensitivity in word mode", () => {
    expect(entryMatchesText(e("FOMO", "word", { caseSensitive: true }), "pure fomo")).toBe(false);
    expect(entryMatchesText(e("FOMO", "word", { caseSensitive: true }), "pure FOMO")).toBe(true);
    expect(entryMatchesText(e("fomo", "word"), "pure FOMO")).toBe(true); // insensitive default
  });
});

describe("entryMatchesText — cashtag mode boundary safety", () => {
  it("matches the exact $TICKER mention", () => {
    expect(entryMatchesText(e("RELIANCE", "cashtag"), "watching $RELIANCE today")).toBe(true);
    expect(entryMatchesText(e("RELIANCE", "cashtag"), "starts with $RELIANCE")).toBe(true);
  });
  it("does NOT match a partial ticker ($REL never hides $RELIANCE)", () => {
    expect(entryMatchesText(e("REL", "cashtag"), "watching $RELIANCE")).toBe(false);
    expect(entryMatchesText(e("NIFTY", "cashtag"), "$NIFTYBEES is an ETF")).toBe(false);
  });
  it("is case-insensitive and requires the $ to begin a word", () => {
    expect(entryMatchesText(e("RELIANCE", "cashtag"), "buy $reliance now")).toBe(true);
    expect(entryMatchesText(e("CASH", "cashtag"), "spent the ca$h")).toBe(false); // mid-word $
  });
  it("does not match the bare word without a $", () => {
    expect(entryMatchesText(e("NIFTY", "cashtag"), "nifty was flat")).toBe(false);
  });
});

describe("entryMatchesText — hashtag mode boundary safety", () => {
  it("matches the exact #tag", () => {
    expect(entryMatchesText(e("options", "hashtag"), "love #options trading")).toBe(true);
  });
  it("does not match a partial tag (#nift never hides #nifty)", () => {
    expect(entryMatchesText(e("nift", "hashtag"), "trading #nifty")).toBe(false);
  });
  it("does not match the bare word without a #", () => {
    expect(entryMatchesText(e("options", "hashtag"), "trading options daily")).toBe(false);
  });
});

describe("isMuteExpired — injected now", () => {
  it("forever (no expiry) is never expired", () => {
    expect(isMuteExpired(e("x"), T0)).toBe(false);
    expect(isMuteExpired(e("x", "substring", { expiresAt: null }), T0)).toBe(false);
  });
  it("expires at/after the instant", () => {
    const future = new Date(T0 + 1000).toISOString();
    const past = new Date(T0 - 1000).toISOString();
    expect(isMuteExpired(e("x", "substring", { expiresAt: future }), T0)).toBe(false);
    expect(isMuteExpired(e("x", "substring", { expiresAt: past }), T0)).toBe(true);
    // exactly at the instant counts as expired
    expect(isMuteExpired(e("x", "substring", { expiresAt: new Date(T0).toISOString() }), T0)).toBe(
      true
    );
  });
  it("treats an unparseable expiry as forever", () => {
    expect(isMuteExpired(e("x", "substring", { expiresAt: "not-a-date" }), T0)).toBe(false);
  });
});

describe("matchesMuted — the matcher over a candidate", () => {
  const candidate = {
    title: "My NIFTY view",
    body: "I think this is a scam, honestly. Watching $RELIANCE.",
    symbols: ["RELIANCE", "NIFTY"],
    tags: ["options"],
  };

  it("empty list hides nothing", () => {
    expect(matchesMuted(candidate, [], T0)).toBeNull();
    expect(isMuted(candidate, [], T0)).toBe(false);
  });
  it("matches across title + body", () => {
    expect(matchesMuted({ ...candidate, body: "" }, [e("nifty")], T0)).not.toBeNull(); // title hit
    expect(matchesMuted({ ...candidate, title: null }, [e("scam")], T0)).not.toBeNull(); // body hit
  });
  it("matches a cashtag carried in the symbols join (not just inline)", () => {
    const onlySymbols = { body: "no tickers in text here", symbols: ["RELIANCE"] };
    expect(isMuted(onlySymbols, [e("RELIANCE", "cashtag")], T0)).toBe(true);
    expect(isMuted(onlySymbols, [e("REL", "cashtag")], T0)).toBe(false); // boundary holds
  });
  it("matches a hashtag carried in the tags array", () => {
    const onlyTags = { body: "plain text", tags: ["options"] };
    expect(isMuted(onlyTags, [e("options", "hashtag")], T0)).toBe(true);
  });
  it("returns WHICH entry hid the item (first match wins)", () => {
    const hit = matchesMuted(candidate, [e("nope"), e("scam"), e("reliance", "cashtag")], T0);
    expect(hit?.term).toBe("scam");
  });
  it("an expired entry never matches even when its term is present", () => {
    const expired = e("scam", "substring", { expiresAt: new Date(T0 - 1).toISOString() });
    expect(isMuted(candidate, [expired], T0)).toBe(false);
    // ...but it matches before it expires
    expect(isMuted(candidate, [expired], T0 - 1000)).toBe(true);
  });
  it("whitespace-only / empty candidate matches nothing", () => {
    expect(matchesMuted({ body: "   " }, [e("scam")], T0)).toBeNull();
    expect(matchesMuted({}, [e("scam")], T0)).toBeNull();
  });
});

describe("candidateText", () => {
  it("renders symbols back into $TICKER and tags into #tag", () => {
    const text = candidateText({ title: "T", body: "B", symbols: ["NIFTY"], tags: ["options"] });
    expect(text).toContain("T");
    expect(text).toContain("B");
    expect(text).toContain("$NIFTY");
    expect(text).toContain("#options");
  });
  it("skips falsy fields", () => {
    expect(candidateText({ body: "only body" })).toBe("only body");
    expect(candidateText({})).toBe("");
  });
});

describe("sanitize + dedupe + limits", () => {
  it("drops malformed entries", () => {
    expect(sanitizeMuteEntry(null)).toBeNull();
    expect(sanitizeMuteEntry({ term: "x", mode: "bogus" })).toBeNull();
    expect(sanitizeMuteEntry({ term: "   ", mode: "substring" })).toBeNull();
    expect(sanitizeMuteEntry({ term: 42, mode: "substring" })).toBeNull();
  });
  it("ignores caseSensitive for cashtag/hashtag modes (always insensitive)", () => {
    const c = sanitizeMuteEntry({ term: "$rel", mode: "cashtag", caseSensitive: true });
    expect(c?.caseSensitive).toBeUndefined();
    expect(c?.term).toBe("REL");
  });
  it("de-dupes same mode + folded term (case-insensitive for substring)", () => {
    const list = sanitizeMuteList([
      { term: "Scam", mode: "substring" },
      { term: "scam", mode: "substring" },
      { term: "scam", mode: "word" }, // different mode → kept
    ]);
    expect(list).toHaveLength(2);
    expect(list[0]!.term).toBe("Scam"); // first-seen preserved
  });
  it("caps at MAX_MUTED_ENTRIES", () => {
    const many = Array.from({ length: MAX_MUTED_ENTRIES + 50 }, (_, i) => ({
      term: `term${i}`,
      mode: "substring" as const,
    }));
    expect(sanitizeMuteList(many)).toHaveLength(MAX_MUTED_ENTRIES);
  });
  it("non-array input → empty list", () => {
    expect(sanitizeMuteList("nope")).toEqual([]);
    expect(sanitizeMuteList(null)).toEqual([]);
  });
});

describe("storage codec round-trip", () => {
  it("null / garbage column → empty list (no muting)", () => {
    expect(parseMutedWords(null)).toEqual([]);
    expect(parseMutedWords("")).toEqual([]);
    expect(parseMutedWords("{not json")).toEqual([]);
    expect(parseMutedWords('{"not":"an array"}')).toEqual([]);
  });
  it("empty list serializes to null (no column for a mute-free user)", () => {
    expect(serializeMutedWords([])).toBeNull();
  });
  it("round-trips a non-empty list", () => {
    const list: MuteEntry[] = [
      e("scam"),
      e("RELIANCE", "cashtag"),
      e("ass", "word", { caseSensitive: true }),
    ];
    const json = serializeMutedWords(list);
    expect(json).not.toBeNull();
    const back = parseMutedWords(json);
    expect(back).toHaveLength(3);
    expect(back.find((x) => x.mode === "cashtag")?.term).toBe("RELIANCE");
    expect(back.find((x) => x.mode === "word")?.caseSensitive).toBe(true);
  });
});

describe("list edits (optimistic UI parity)", () => {
  it("adds to the front, normalizing", () => {
    const list = addMuteEntry([], { term: "$reliance", mode: "cashtag" });
    expect(list[0]!.term).toBe("RELIANCE");
  });
  it("re-adding the same term replaces + moves to front (refreshes expiry)", () => {
    let list = addMuteEntry([], e("scam", "substring", { expiresAt: new Date(T0).toISOString() }));
    list = addMuteEntry(list, e("other"));
    list = addMuteEntry(list, e("scam", "substring", { expiresAt: null }));
    expect(list).toHaveLength(2);
    expect(list[0]!.term).toBe("scam");
    expect(list[0]!.expiresAt).toBeUndefined();
  });
  it("does not grow past the cap for a genuinely new term", () => {
    const full = sanitizeMuteList(
      Array.from({ length: MAX_MUTED_ENTRIES }, (_, i) => ({
        term: `t${i}`,
        mode: "substring" as const,
      }))
    );
    const after = addMuteEntry(full, e("brand-new"));
    expect(after).toHaveLength(MAX_MUTED_ENTRIES);
  });
  it("removes by mode + (any-cased) term", () => {
    const list = [e("Scam"), e("RELIANCE", "cashtag")];
    expect(removeMuteEntry(list, "substring", "scam")).toHaveLength(1);
    expect(removeMuteEntry(list, "cashtag", "$reliance")).toHaveLength(1);
    expect(removeMuteEntry(list, "substring", "nomatch")).toHaveLength(2);
  });
});

describe("describeMuteEntry", () => {
  it("formats each mode honestly", () => {
    expect(describeMuteEntry(e("RELIANCE", "cashtag"))).toBe("$RELIANCE");
    expect(describeMuteEntry(e("options", "hashtag"))).toBe("#options");
    expect(describeMuteEntry(e("ass", "word"))).toBe('"ass" (whole word)');
    expect(describeMuteEntry(e("scam"))).toBe('"scam"');
  });
});
