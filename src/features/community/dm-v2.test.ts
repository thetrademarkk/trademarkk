import { describe, expect, it } from "vitest";
import {
  classifyAttachment,
  countUnread,
  DELETED_MESSAGE_TEXT,
  deliveryState,
  extractFirstLink,
  isDeleted,
  isImageUrl,
  isMessageReactionKind,
  isTyping,
  MESSAGE_REACTION_KINDS,
  nextLastRead,
  parseMessageReactions,
  serializeMessageReactions,
  shouldSendTypingPing,
  summarizeMessageReactions,
  toggleMessageReaction,
  TYPING_TTL_MS,
  type MessageReactionMap,
} from "./dm-v2";

describe("message reactions", () => {
  it("validates known kinds only", () => {
    for (const k of MESSAGE_REACTION_KINDS) expect(isMessageReactionKind(k)).toBe(true);
    expect(isMessageReactionKind("nope")).toBe(false);
    expect(isMessageReactionKind(null)).toBe(false);
    expect(isMessageReactionKind(42)).toBe(false);
  });

  it("toggles: add, remove, switch", () => {
    let map: MessageReactionMap = {};
    map = toggleMessageReaction(map, "u1", "like");
    expect(map).toEqual({ u1: "like" });
    // same kind removes
    map = toggleMessageReaction(map, "u1", "like");
    expect(map).toEqual({});
    // add then switch
    map = toggleMessageReaction(map, "u1", "love");
    map = toggleMessageReaction(map, "u1", "laugh");
    expect(map).toEqual({ u1: "laugh" });
  });

  it("toggle is immutable (does not mutate input)", () => {
    const map: MessageReactionMap = { u1: "like" };
    const next = toggleMessageReaction(map, "u2", "love");
    expect(map).toEqual({ u1: "like" });
    expect(next).toEqual({ u1: "like", u2: "love" });
  });

  it("parses tolerantly and drops garbage", () => {
    expect(parseMessageReactions(null)).toEqual({});
    expect(parseMessageReactions("not json")).toEqual({});
    expect(parseMessageReactions("[1,2,3]")).toEqual({});
    expect(parseMessageReactions(JSON.stringify({ u1: "like", u2: "bogus", u3: 5 }))).toEqual({
      u1: "like",
    });
  });

  it("serializes deterministically (sorted keys) or null when empty", () => {
    expect(serializeMessageReactions({})).toBeNull();
    const a = serializeMessageReactions({ z: "like", a: "love" });
    const b = serializeMessageReactions({ a: "love", z: "like" });
    expect(a).toBe(b);
    expect(a).toBe('{"a":"love","z":"like"}');
  });

  it("round-trips through serialize/parse", () => {
    const map: MessageReactionMap = { u1: "celebrate", u2: "sad" };
    expect(parseMessageReactions(serializeMessageReactions(map))).toEqual(map);
  });

  it("summarizes per-kind counts in display order with viewer's own marked", () => {
    const map: MessageReactionMap = { u1: "love", u2: "love", u3: "like", me: "like" };
    const summary = summarizeMessageReactions(map, "me");
    // display order: like before love
    expect(summary.map((s) => s.kind)).toEqual(["like", "love"]);
    expect(summary.find((s) => s.kind === "like")).toMatchObject({ count: 2, mine: true });
    expect(summary.find((s) => s.kind === "love")).toMatchObject({ count: 2, mine: false });
  });

  it("summary with no viewer marks nothing mine", () => {
    const summary = summarizeMessageReactions({ u1: "like" }, null);
    expect(summary[0]).toMatchObject({ kind: "like", count: 1, mine: false });
  });
});

describe("typing indicator TTL", () => {
  const base = Date.parse("2026-06-14T10:00:00.000Z");
  it("null / unparseable is not typing", () => {
    expect(isTyping(null, base)).toBe(false);
    expect(isTyping(undefined, base)).toBe(false);
    expect(isTyping("garbage", base)).toBe(false);
  });
  it("fresh signal is typing, expired is not (injectable now)", () => {
    const at = new Date(base).toISOString();
    expect(isTyping(at, base + 1000)).toBe(true);
    expect(isTyping(at, base + TYPING_TTL_MS - 1)).toBe(true);
    expect(isTyping(at, base + TYPING_TTL_MS)).toBe(false);
    expect(isTyping(at, base + TYPING_TTL_MS + 5000)).toBe(false);
  });
  it("future timestamp (clock skew) still counts as live", () => {
    const future = new Date(base + 2000).toISOString();
    expect(isTyping(future, base)).toBe(true);
  });
});

describe("typing ping throttle", () => {
  const now = 100_000;
  it("first ping always sends", () => {
    expect(shouldSendTypingPing(null, now)).toBe(true);
  });
  it("re-pings only after the interval", () => {
    expect(shouldSendTypingPing(now - 1000, now, 3000)).toBe(false);
    expect(shouldSendTypingPing(now - 3000, now, 3000)).toBe(true);
    expect(shouldSendTypingPing(now - 4000, now, 3000)).toBe(true);
  });
});

describe("delivery / seen state", () => {
  const t = (s: string) => `2026-06-14T10:00:0${s}.000Z`;
  it("optimistic → sending", () => {
    expect(deliveryState(t("0"), true, null, null)).toBe("sending");
  });
  it("no peer activity → sent", () => {
    expect(deliveryState(t("5"), false, null, null)).toBe("sent");
  });
  it("peer seen the thread but not yet this message → delivered", () => {
    expect(deliveryState(t("5"), false, t("0"), t("9"))).toBe("delivered");
  });
  it("peer last-read at/after the message → seen", () => {
    expect(deliveryState(t("5"), false, t("5"), t("5"))).toBe("seen");
    expect(deliveryState(t("5"), false, t("9"), t("9"))).toBe("seen");
  });
  it("seen takes precedence over delivered", () => {
    expect(deliveryState(t("5"), false, t("9"), t("1"))).toBe("seen");
  });
  it("unparseable createdAt degrades to sent", () => {
    expect(deliveryState("bad", false, t("9"), t("9"))).toBe("sent");
  });
});

describe("unread derivation", () => {
  const msgs = [
    { senderId: "peer", createdAt: "2026-06-14T10:00:01.000Z" },
    { senderId: "me", createdAt: "2026-06-14T10:00:02.000Z" },
    { senderId: "peer", createdAt: "2026-06-14T10:00:03.000Z" },
    { senderId: "peer", createdAt: "2026-06-14T10:00:04.000Z" },
  ];
  it("counts only peer messages after the last-read mark", () => {
    expect(countUnread(msgs, "me", "2026-06-14T10:00:02.000Z")).toBe(2);
    expect(countUnread(msgs, "me", "2026-06-14T10:00:03.000Z")).toBe(1);
    expect(countUnread(msgs, "me", "2026-06-14T10:00:04.000Z")).toBe(0);
  });
  it("null last-read → all peer messages unread", () => {
    expect(countUnread(msgs, "me", null)).toBe(3);
  });
  it("never counts the viewer's own messages", () => {
    expect(countUnread(msgs, "peer", null)).toBe(1); // only the "me" message
  });
  it("ignores unparseable timestamps", () => {
    expect(countUnread([{ senderId: "peer", createdAt: "x" }], "me", null)).toBe(0);
  });
});

describe("nextLastRead", () => {
  it("advances to the latest message", () => {
    const msgs = [
      { createdAt: "2026-06-14T10:00:01.000Z" },
      { createdAt: "2026-06-14T10:00:05.000Z" },
    ];
    expect(nextLastRead(msgs, null)).toBe("2026-06-14T10:00:05.000Z");
  });
  it("never moves backwards below the floor", () => {
    const msgs = [{ createdAt: "2026-06-14T10:00:01.000Z" }];
    expect(nextLastRead(msgs, "2026-06-14T10:00:09.000Z")).toBe("2026-06-14T10:00:09.000Z");
  });
  it("empty messages keeps the floor", () => {
    expect(nextLastRead([], "2026-06-14T10:00:09.000Z")).toBe("2026-06-14T10:00:09.000Z");
    expect(nextLastRead([], null)).toBeNull();
  });
});

describe("soft-delete tombstone", () => {
  it("detects deletion", () => {
    expect(isDeleted(null)).toBe(false);
    expect(isDeleted(undefined)).toBe(false);
    expect(isDeleted("2026-06-14T10:00:00.000Z")).toBe(true);
  });
  it("has stable tombstone copy", () => {
    expect(DELETED_MESSAGE_TEXT).toMatch(/deleted/i);
  });
});

describe("image / link detection", () => {
  it("recognizes https image URLs by extension", () => {
    expect(isImageUrl("https://i.imgur.com/abc.png")).toBe(true);
    expect(isImageUrl("https://x.com/a/b/chart.JPEG")).toBe(true);
    expect(isImageUrl("https://x.com/c.webp?w=600")).toBe(true);
    expect(isImageUrl("https://x.com/c.svg")).toBe(true);
  });
  it("rejects non-image, non-https, and malformed URLs", () => {
    expect(isImageUrl("https://example.com/article")).toBe(false);
    expect(isImageUrl("http://i.imgur.com/abc.png")).toBe(false); // http blocked
    expect(isImageUrl("not a url")).toBe(false);
    expect(isImageUrl("https://x.com/page.html")).toBe(false);
  });

  it("extracts the first link and trims trailing punctuation", () => {
    expect(extractFirstLink("see https://example.com.")).toBe("https://example.com");
    expect(extractFirstLink("(https://a.bc/x)")).toBe("https://a.bc/x");
    expect(extractFirstLink("no link here")).toBeNull();
    expect(extractFirstLink("http://a")).toBeNull(); // too short / not matched fully
  });

  it("classifies the first attachment as image or link", () => {
    expect(classifyAttachment("look https://i.imgur.com/x.png nice")).toEqual({
      kind: "image",
      url: "https://i.imgur.com/x.png",
    });
    expect(classifyAttachment("read https://news.site/post")).toEqual({
      kind: "link",
      url: "https://news.site/post",
    });
    expect(classifyAttachment("plain text")).toBeNull();
  });
});
