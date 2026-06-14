import { describe, expect, it } from "vitest";
import {
  classifyTipLanguage,
  classifyLowEffort,
  classifyAllCaps,
  isNearDuplicate,
  jaccard,
  longestCharRun,
  upperCaseRatio,
  countLinks,
  normalizeForDup,
  previewPostQuality,
  evaluatePostQuality,
} from "./quality";

/* ── 1. Tip / pump / solicitation ──────────────────────────────────────────── */

describe("classifyTipLanguage — hard-block solicitation", () => {
  it("blocks join-my-paid-telegram solicitation", () => {
    const v = classifyTipLanguage("Join my premium telegram channel for daily calls!");
    expect(v?.decision).toBe("block");
    expect(v?.message).toMatch(/educational discussion only/i);
  });
  it("blocks DM-me-for-calls solicitation", () => {
    expect(classifyTipLanguage("DM me for sure shot intraday calls")!.decision).toBe("block");
    expect(classifyTipLanguage("Ping me for guaranteed profit signals")!.decision).toBe("block");
  });
  it("blocks a bare telegram/whatsapp invite link", () => {
    expect(classifyTipLanguage("Best tips here t.me/profitcalls join now")!.decision).toBe("block");
    expect(classifyTipLanguage("contact wa.me/919999999999")!.decision).toBe("block");
    expect(classifyTipLanguage("https://chat.whatsapp.com/abcd")!.decision).toBe("block");
  });
  it("blocks a paid VIP group pitch with a contact channel", () => {
    expect(
      classifyTipLanguage("VIP membership service available, message on whatsapp to join")!.decision
    ).toBe("block");
  });
});

describe("classifyTipLanguage — soft-flag tip language (never blocks)", () => {
  it("flags assured-return / guarantee language", () => {
    const v = classifyTipLanguage("Guaranteed profit if you follow this");
    expect(v?.decision).toBe("flag");
    expect(v?.flag).toBe("tip");
  });
  it("flags sure-shot / jackpot / multibagger", () => {
    expect(classifyTipLanguage("Sure shot trade for tomorrow")!.flag).toBe("tip");
    expect(classifyTipLanguage("This is a jackpot stock")!.flag).toBe("tip");
    expect(classifyTipLanguage("Next multibagger in 6 months")!.flag).toBe("tip");
  });
  it("flags the rigid BUY/TARGET/SL imperative call shape", () => {
    expect(classifyTipLanguage("BUY NIFTY target 25000 SL 24800")!.flag).toBe("tip");
    expect(classifyTipLanguage("Sell BANKNIFTY stoploss 52000 target 51000")!.flag).toBe("tip");
  });
  it("flags 'today's tip' / 'intraday call' phrasing", () => {
    expect(classifyTipLanguage("Today's tip: buy RELIANCE")!.flag).toBe("tip");
    expect(classifyTipLanguage("Free intraday calls below")!.flag).toBe("tip");
  });
  it("flags X% profit claims", () => {
    expect(classifyTipLanguage("Make 30% profit this week")!.flag).toBe("tip");
  });
});

describe("classifyTipLanguage — FALSE-POSITIVE guards (genuine analysis stays clean)", () => {
  const clean = [
    "I think NIFTY could test 25000 this week — my reasoning is the OI buildup at 25000CE and a strong global setup. Risk: a gap-down on bad US data.",
    "I bought BANKNIFTY 52000CE as a swing; my target zone is 52800 and I'll cut if it loses 51500. This is just my plan, not advice.",
    "Lesson from today: I exited too early on RELIANCE. The setup was a clean breakout and I left profit on the table because I was nervous.",
    "What do you all think about the IT sector? TCS looks weak to me but I'm not sure why the volumes dried up.",
    "My backtest shows this mean-reversion idea has a positive expectancy over 200 trades. Sharing the equity curve below.",
    "Booked a small loss on $NIFTY today. In my view the trend was against me from the open — I should have waited.",
    "Target hit on my journal entry from last week — happy I stuck to the plan and did not move my stop.",
  ];
  it.each(clean)("does not flag genuine analysis: %s", (body) => {
    expect(classifyTipLanguage(body)).toBeNull();
  });
  it("does not block merely MENTIONING telegram in analysis", () => {
    expect(
      classifyTipLanguage(
        "I saw a telegram group pushing this stock and I think it's a pump — here's why I'm avoiding it."
      )
    ).toBeNull();
  });
  it("does not flag a lone target with reasoning (no SL imperative)", () => {
    expect(
      classifyTipLanguage("My target on NIFTY is 25000 because of the weekly resistance there.")
    ).toBeNull();
  });
  it("downgrades SOFT tip language amid genuine analysis", () => {
    // "intraday tips" appears, but the post reflects/reasons → not flagged.
    expect(
      classifyTipLanguage(
        "I stopped following intraday tips because my journal showed they hurt my expectancy."
      )
    ).toBeNull();
  });
  it("still flags bare soft tip language with no analysis", () => {
    expect(classifyTipLanguage("Free intraday calls below, follow now")!.flag).toBe("tip");
  });
  it("never downgrades a STRONG tip pattern even amid analysis", () => {
    // Guarantee language + reasoning words → still flags (strong patterns ignore the hint).
    expect(
      classifyTipLanguage("In my view this is a guaranteed profit, because the setup is perfect")!
        .flag
    ).toBe("tip");
  });
});

/* ── 2. Low-effort / spam ──────────────────────────────────────────────────── */

describe("classifyLowEffort", () => {
  it("blocks empty / near-empty bodies", () => {
    expect(classifyLowEffort("ok")!.decision).toBe("block");
    expect(classifyLowEffort("....")!.decision).toBe("block");
    expect(classifyLowEffort("   hi  ")!.decision).toBe("block");
  });
  it("blocks keyboard-mashing (excessive repeated chars)", () => {
    expect(classifyLowEffort("aaaaaaaaaaaaaaaaaa nice")!.decision).toBe("block");
    expect(classifyLowEffort("soooooooooooooooo good")!.decision).toBe("block");
  });
  it("blocks link-only / link-dominated posts", () => {
    expect(classifyLowEffort("https://example.com/abc")!.decision).toBe("block");
    expect(classifyLowEffort("see https://example.com/abc lol")!.decision).toBe("block");
  });
  it("allows a link WITH real context", () => {
    expect(
      classifyLowEffort(
        "Great writeup on position sizing, changed how I think about risk: https://example.com/sizing"
      )
    ).toBeNull();
  });
  it("FALSE-POSITIVE guard: normal short posts pass", () => {
    expect(
      classifyLowEffort("NIFTY closed strong above 25000 today, watching for follow-through.")
    ).toBeNull();
    expect(classifyLowEffort("Anyone else long banknifty into expiry?")).toBeNull();
  });
});

describe("classifyAllCaps — soft flag", () => {
  it("flags a long all-caps wall", () => {
    const v = classifyAllCaps("THIS STOCK IS GOING TO THE MOON BUY IT RIGHT NOW BEFORE IT RUNS");
    expect(v?.decision).toBe("flag");
    expect(v?.flag).toBe("all-caps");
  });
  it("FALSE-POSITIVE guard: short shouty emphasis and tickers are fine", () => {
    expect(classifyAllCaps("HUGE day, NIFTY ripped higher")).toBeNull();
    expect(classifyAllCaps("$NIFTY $BANKNIFTY $RELIANCE watchlist for tomorrow")).toBeNull();
    expect(classifyAllCaps("My P&L was great today, learned a lot about patience.")).toBeNull();
  });
});

describe("low-level helpers", () => {
  it("longestCharRun counts the longest run", () => {
    expect(longestCharRun("aaa")).toBe(3);
    expect(longestCharRun("abcabc")).toBe(1);
    expect(longestCharRun("")).toBe(0);
  });
  it("upperCaseRatio over latin letters only", () => {
    expect(upperCaseRatio("ABC")).toBe(1);
    expect(upperCaseRatio("abc")).toBe(0);
    expect(upperCaseRatio("$NIFTY 25000!!!")).toBeGreaterThan(0.9); // digits/punct excluded
    expect(upperCaseRatio("123 !!!")).toBe(0); // no letters
  });
  it("countLinks counts http/https", () => {
    expect(countLinks("a https://x.com b http://y.com")).toBe(2);
    expect(countLinks("no links here")).toBe(0);
  });
});

/* ── 3. Near-duplicate ─────────────────────────────────────────────────────── */

describe("isNearDuplicate", () => {
  const original =
    "NIFTY broke above 25000 today with strong volume, watching for a retest tomorrow";
  it("flags an exact repost", () => {
    expect(isNearDuplicate(original, [original])).toBe(true);
  });
  it("flags a near-identical repost (minor edits)", () => {
    expect(
      isNearDuplicate(
        "NIFTY broke above 25000 today with strong volume, watching for a retest tomorrow!!",
        [original]
      )
    ).toBe(true);
  });
  it("flags a repost differing only in punctuation/case/links", () => {
    expect(isNearDuplicate(original.toUpperCase() + " https://x.com", [original])).toBe(true);
  });
  it("FALSE-POSITIVE guard: a genuinely different post is not a duplicate", () => {
    expect(
      isNearDuplicate("BANKNIFTY looks weak into expiry, might short with a tight stop", [original])
    ).toBe(false);
  });
  it("FALSE-POSITIVE guard: a short distinct post is not a duplicate of a short prior", () => {
    expect(isNearDuplicate("good trade today", ["bad trade today"])).toBe(false);
  });
  it("short bodies require EXACT normalized equality", () => {
    expect(isNearDuplicate("nifty up", ["nifty up"])).toBe(true);
    expect(isNearDuplicate("nifty up", ["nifty down"])).toBe(false);
  });
  it("empty recent corpus never matches", () => {
    expect(isNearDuplicate(original, [])).toBe(false);
  });

  it("jaccard math", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
    expect(jaccard(new Set(["a", "b"]), new Set(["c", "d"]))).toBe(0);
    expect(jaccard(new Set(), new Set())).toBe(1);
  });
  it("normalizeForDup strips urls, punctuation, case, whitespace", () => {
    expect(normalizeForDup("Hello,  WORLD!! https://x.com")).toBe("hello world");
  });
});

/* ── Composite evaluation ──────────────────────────────────────────────────── */

describe("evaluatePostQuality — precedence + decisions", () => {
  it("allows clean genuine analysis", () => {
    const v = evaluatePostQuality({
      body: "I think NIFTY could retest 25000; here's my reasoning and the risk I'm taking.",
    });
    expect(v.decision).toBe("allow");
    expect(v.flag).toBeNull();
  });

  it("blocks egregious solicitation", () => {
    expect(
      evaluatePostQuality({ body: "Join my paid telegram channel for daily signals" }).decision
    ).toBe("block");
  });

  it("soft-flags a tip post (allowed but flagged)", () => {
    const v = evaluatePostQuality({ body: "BUY NIFTY target 25000 SL 24800 sure shot" });
    expect(v.decision).toBe("flag");
    expect(v.flag).toBe("tip");
  });

  it("blocks a near-duplicate repost", () => {
    const prior = "NIFTY broke above 25000 with strong volume, watching for a retest tomorrow";
    const v = evaluatePostQuality({
      body: "NIFTY broke above 25000 with strong volume, watching for a retest tomorrow!",
      recentBodies: [prior],
    });
    expect(v.decision).toBe("block");
    expect(v.message).toMatch(/almost identical/i);
  });

  it("low-effort block takes precedence over everything", () => {
    expect(evaluatePostQuality({ body: "ok" }).decision).toBe("block");
  });

  it("solicitation outranks a near-duplicate (both present)", () => {
    const body = "Join my paid telegram channel for daily signals";
    const v = evaluatePostQuality({ body, recentBodies: [body] });
    expect(v.decision).toBe("block");
    expect(v.message).toMatch(/solicitation|educational/i);
  });

  it("tip flag outranks all-caps flag when both apply", () => {
    const v = evaluatePostQuality({
      body: "BUY NIFTY TARGET 25000 SL 24800 GUARANTEED SURE SHOT PROFIT FOR EVERYONE TODAY",
    });
    expect(v.decision).toBe("flag");
    expect(v.flag).toBe("tip");
  });

  it("flags a standalone all-caps wall", () => {
    const v = evaluatePostQuality({
      body: "THE MARKET IS GOING TO CRASH HARD TOMORROW EVERYONE SHOULD BE CAREFUL OUT THERE",
    });
    expect(v.decision).toBe("flag");
    expect(v.flag).toBe("all-caps");
  });
});

describe("previewPostQuality — composer nudge (advisory only)", () => {
  it("returns null for clean drafts", () => {
    expect(
      previewPostQuality("Sharing my reasoning on why I'm watching NIFTY this week.")
    ).toBeNull();
  });
  it("nudges on tip language", () => {
    expect(previewPostQuality("BUY NIFTY target 25000 SL 24800")).toMatch(/educational/i);
  });
  it("nudges (strongly) on solicitation", () => {
    expect(previewPostQuality("Join my paid telegram for calls")).toMatch(
      /solicitation|educational/i
    );
  });
  it("nudges on an all-caps wall", () => {
    expect(
      previewPostQuality("THIS IS A VERY LONG ALL CAPS SHOUTING MESSAGE THAT KEEPS GOING ON")
    ).toMatch(/all caps/i);
  });
  it("does NOT run the near-dup check (no message for a repost)", () => {
    expect(previewPostQuality("a perfectly normal post about my trading day")).toBeNull();
  });
});
