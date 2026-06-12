import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMUNITY_DRAFT_KEY, clearDraft, isEmptyDraft, readDraft, writeDraft } from "./draft";

/** Minimal in-memory Storage — vitest runs in a node environment. */
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

let store: Storage;

beforeEach(() => {
  store = makeStorage();
  vi.stubGlobal("localStorage", store);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("draft round-trip", () => {
  it("writes then reads back title/body/tags", () => {
    writeDraft({
      title: "Expiry scalp",
      body: "What I learned today",
      tags: ["nifty", "psychology"],
    });
    expect(readDraft()).toEqual({
      title: "Expiry scalp",
      body: "What I learned today",
      tags: ["nifty", "psychology"],
    });
  });

  it("uses the tm.community-draft key by default", () => {
    writeDraft({ title: "", body: "hello", tags: [] });
    expect(store.getItem(COMMUNITY_DRAFT_KEY)).toContain("hello");
  });

  it("supports custom keys", () => {
    writeDraft({ title: "", body: "elsewhere", tags: [] }, "tm.other-draft");
    expect(readDraft("tm.other-draft")?.body).toBe("elsewhere");
    expect(readDraft()).toBeNull();
  });
});

describe("empty drafts", () => {
  it("isEmptyDraft treats whitespace-only fields as empty", () => {
    expect(isEmptyDraft({ title: "  ", body: "\n\t", tags: [] })).toBe(true);
    expect(isEmptyDraft({ title: "", body: "", tags: ["nifty"] })).toBe(false);
  });

  it("writing an empty draft removes the stored key", () => {
    writeDraft({ title: "", body: "keep me", tags: [] });
    expect(store.getItem(COMMUNITY_DRAFT_KEY)).not.toBeNull();
    writeDraft({ title: "", body: "", tags: [] });
    expect(store.getItem(COMMUNITY_DRAFT_KEY)).toBeNull();
  });

  it("reading an absent key returns null", () => {
    expect(readDraft()).toBeNull();
  });

  it("clearDraft removes the draft", () => {
    writeDraft({ title: "", body: "bye", tags: [] });
    clearDraft();
    expect(readDraft()).toBeNull();
  });
});

describe("corrupt or hostile stored values", () => {
  it("returns null for invalid JSON", () => {
    store.setItem(COMMUNITY_DRAFT_KEY, "{not json");
    expect(readDraft()).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    store.setItem(COMMUNITY_DRAFT_KEY, JSON.stringify("just a string"));
    expect(readDraft()).toBeNull();
    store.setItem(COMMUNITY_DRAFT_KEY, JSON.stringify(null));
    expect(readDraft()).toBeNull();
  });

  it("coerces wrong field types to safe defaults", () => {
    store.setItem(COMMUNITY_DRAFT_KEY, JSON.stringify({ title: 42, body: "ok", tags: "nope" }));
    expect(readDraft()).toEqual({ title: "", body: "ok", tags: [] });
  });

  it("drops non-string and invalid tags, keeps valid ones", () => {
    store.setItem(
      COMMUNITY_DRAFT_KEY,
      JSON.stringify({ body: "ok", tags: [7, "nifty", "NOT VALID", "x", "options"] })
    );
    expect(readDraft()?.tags).toEqual(["nifty", "options"]);
  });

  it("clamps oversized fields to schema limits", () => {
    store.setItem(
      COMMUNITY_DRAFT_KEY,
      JSON.stringify({
        title: "t".repeat(500),
        body: "b".repeat(9000),
        tags: ["aa", "bb", "cc", "dd", "ee", "ff"],
      })
    );
    const d = readDraft();
    expect(d?.title).toHaveLength(120);
    expect(d?.body).toHaveLength(5000);
    expect(d?.tags).toHaveLength(4);
  });

  it("a draft that clamps down to empty reads as null", () => {
    store.setItem(COMMUNITY_DRAFT_KEY, JSON.stringify({ tags: ["NOT VALID"] }));
    expect(readDraft()).toBeNull();
  });
});

describe("storage unavailable", () => {
  it("read/write/clear are no-ops without localStorage", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", undefined);
    expect(() => writeDraft({ title: "", body: "x", tags: [] })).not.toThrow();
    expect(readDraft()).toBeNull();
    expect(() => clearDraft()).not.toThrow();
  });

  it("write swallows quota errors", () => {
    store.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(() => writeDraft({ title: "", body: "x", tags: [] })).not.toThrow();
  });
});
