import { describe, expect, it } from "vitest";
import {
  EDIT_WINDOW_MS,
  MAX_EDIT_HISTORY,
  appendEditSnapshot,
  editCount,
  editMinutesLeft,
  editMsLeft,
  isWithinEditWindow,
  parseEditHistory,
  type CommentEditSnapshot,
  type PostEditSnapshot,
} from "./edit-window";
import { editPostSchema, editCommentSchema } from "./schemas";

const at = (msAfter: number) => new Date(msAfter).toISOString();

describe("isWithinEditWindow — boundaries", () => {
  const created = at(0);
  it("is editable at the moment of creation (0ms elapsed)", () => {
    expect(isWithinEditWindow(created, 0)).toBe(true);
  });
  it("is editable one ms before the window closes", () => {
    expect(isWithinEditWindow(created, EDIT_WINDOW_MS - 1)).toBe(true);
  });
  it("is NOT editable exactly at the window boundary (exclusive end)", () => {
    expect(isWithinEditWindow(created, EDIT_WINDOW_MS)).toBe(false);
  });
  it("is NOT editable one ms after the window closes", () => {
    expect(isWithinEditWindow(created, EDIT_WINDOW_MS + 1)).toBe(false);
  });
  it("treats a future createdAt as still editable (clock skew, never negative)", () => {
    expect(isWithinEditWindow(at(1000), 0)).toBe(true);
  });
  it("treats an unparseable timestamp as expired", () => {
    expect(isWithinEditWindow("not-a-date", 0)).toBe(false);
  });
});

describe("editMinutesLeft", () => {
  const created = at(0);
  it("is the full 15 minutes at creation", () => {
    expect(editMinutesLeft(created, 0)).toBe(15);
  });
  it("rounds up the final partial minute (14m30s elapsed → 1 min left)", () => {
    expect(editMinutesLeft(created, 14.5 * 60_000)).toBe(1);
  });
  it("is 1 min one ms before close", () => {
    expect(editMinutesLeft(created, EDIT_WINDOW_MS - 1)).toBe(1);
  });
  it("is 0 once the window has closed", () => {
    expect(editMinutesLeft(created, EDIT_WINDOW_MS)).toBe(0);
    expect(editMinutesLeft(created, EDIT_WINDOW_MS + 99_999)).toBe(0);
  });
  it("editMsLeft mirrors the window and floors at 0", () => {
    expect(editMsLeft(created, 0)).toBe(EDIT_WINDOW_MS);
    expect(editMsLeft(created, EDIT_WINDOW_MS + 5)).toBe(0);
  });
});

describe("parseEditHistory — tolerant", () => {
  it("returns [] for null/empty/garbage", () => {
    expect(parseEditHistory(null)).toEqual([]);
    expect(parseEditHistory("")).toEqual([]);
    expect(parseEditHistory("{not json")).toEqual([]);
    expect(parseEditHistory("{}")).toEqual([]); // object, not array
  });
  it("parses a real array", () => {
    const json = JSON.stringify([{ editedAt: at(1), body: "old" }]);
    expect(parseEditHistory<CommentEditSnapshot>(json)).toHaveLength(1);
  });
});

describe("appendEditSnapshot — append-only invariant", () => {
  const s = (n: number): CommentEditSnapshot => ({ editedAt: at(n), body: `v${n}` });

  it("appends to the end, preserving prior snapshots verbatim", () => {
    let json = appendEditSnapshot(null, s(1));
    json = appendEditSnapshot(json, s(2));
    json = appendEditSnapshot(json, s(3));
    const hist = parseEditHistory<CommentEditSnapshot>(json);
    expect(hist.map((h) => h.body)).toEqual(["v1", "v2", "v3"]); // oldest first, growing
  });

  it("NEVER removes or rewrites an existing snapshot across many edits", () => {
    let json: string | null = null;
    const bodies: string[] = [];
    for (let i = 1; i <= 20; i++) {
      bodies.push(`v${i}`);
      json = appendEditSnapshot(json, s(i));
      const hist = parseEditHistory<CommentEditSnapshot>(json);
      // Every previously-captured body is still present, in order.
      expect(hist.map((h) => h.body)).toEqual(bodies);
    }
  });

  it("the returned JSON is a superset — count only ever increases", () => {
    const j1 = appendEditSnapshot(null, s(1));
    const j2 = appendEditSnapshot(j1, s(2));
    expect(editCount(j2)).toBeGreaterThan(editCount(j1));
  });

  it("caps at MAX_EDIT_HISTORY by dropping only the OLDEST entries (never the newest)", () => {
    let json: string | null = null;
    for (let i = 0; i < MAX_EDIT_HISTORY + 5; i++) json = appendEditSnapshot(json, s(i));
    const hist = parseEditHistory<CommentEditSnapshot>(json);
    expect(hist).toHaveLength(MAX_EDIT_HISTORY);
    // The last (newest) snapshot is always retained.
    expect(hist[hist.length - 1]!.body).toBe(`v${MAX_EDIT_HISTORY + 4}`);
    // The very first ones were the ones dropped.
    expect(hist[0]!.body).toBe("v5");
  });

  it("works for post snapshots (title + tags carried)", () => {
    const snap: PostEditSnapshot = { editedAt: at(1), title: "T", body: "B", tags: ["nifty"] };
    const json = appendEditSnapshot(null, snap);
    expect(parseEditHistory<PostEditSnapshot>(json)[0]).toEqual(snap);
  });
});

describe("edit re-validation mirrors create (same zod rules)", () => {
  it("editPostSchema rejects a too-short body and >4 tags", () => {
    expect(editPostSchema.safeParse({ body: "x" }).success).toBe(false);
    expect(
      editPostSchema.safeParse({ body: "valid body", tags: ["a", "b", "c", "d", "e"] }).success
    ).toBe(false);
  });
  it("editPostSchema accepts a valid edit and defaults tags to []", () => {
    const r = editPostSchema.safeParse({ body: "a fine edit" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tags).toEqual([]);
  });
  it("editCommentSchema requires a non-empty body within 2000 chars", () => {
    expect(editCommentSchema.safeParse({ body: "" }).success).toBe(false);
    expect(editCommentSchema.safeParse({ body: "x".repeat(2001) }).success).toBe(false);
    expect(editCommentSchema.safeParse({ body: "ok" }).success).toBe(true);
  });
});

/**
 * @mention re-extraction on edit: only handles NEWLY introduced by the edit
 * should be notified. This mirrors the server's notifyNewMentions diff logic
 * (kept here as a pure unit so the invariant is locked even though the route
 * does the DB lookup).
 */
function newlyMentioned(oldText: string, newText: string): string[] {
  const extract = (t: string) =>
    [...new Set([...t.matchAll(/@([a-z0-9_]{3,20})/g)].map((m) => m[1]!))].slice(0, 5);
  const before = new Set(extract(oldText));
  return extract(newText).filter((h) => !before.has(h));
}

describe("mention re-extraction diff on edit", () => {
  it("notifies only the handle added by the edit", () => {
    expect(newlyMentioned("hey @alpha", "hey @alpha and @beta")).toEqual(["beta"]);
  });
  it("does not re-notify a handle that was already mentioned", () => {
    expect(newlyMentioned("hey @alpha", "hello @alpha again")).toEqual([]);
  });
  it("treats a fresh mention in an edit of a non-mentioning post as new", () => {
    expect(newlyMentioned("plain text", "now @gamma")).toEqual(["gamma"]);
  });
  it("dropping a mention notifies nobody", () => {
    expect(newlyMentioned("@alpha @beta", "@alpha only")).toEqual([]);
  });
});
