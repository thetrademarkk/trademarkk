import { describe, expect, it } from "vitest";
import {
  buildModQueue,
  buildPreview,
  clampPage,
  clampPageSize,
  countOpen,
  MOD_PAGE_SIZE_DEFAULT,
  MOD_PAGE_SIZE_MAX,
  splitReason,
  type ModQueueItem,
} from "./moderation";

const item = (over: Partial<ModQueueItem>): ModQueueItem => ({
  key: over.key ?? Math.random().toString(36).slice(2),
  source: "report",
  status: "open",
  targetType: "post",
  targetId: "p1",
  postId: "p1",
  label: "spam",
  note: null,
  preview: "preview",
  author: "alice",
  authorId: "u-alice",
  authorBanned: false,
  reporter: "bob",
  createdAt: "2026-06-14T10:00:00.000Z",
  ...over,
});

describe("splitReason", () => {
  it("parses a bare reason", () => {
    expect(splitReason("spam")).toEqual({ label: "spam", note: null });
  });
  it("splits reason and note", () => {
    expect(splitReason("spam: posting telegram links")).toEqual({
      label: "spam",
      note: "posting telegram links",
    });
  });
  it("falls back when null/empty", () => {
    expect(splitReason(null)).toEqual({ label: "reported", note: null });
    expect(splitReason("")).toEqual({ label: "reported", note: null });
  });
});

describe("buildPreview", () => {
  it("prefixes the title with an em dash", () => {
    expect(buildPreview("Title", "body text")).toBe("Title — body text");
  });
  it("omits the prefix without a title and truncates", () => {
    expect(buildPreview(null, "x".repeat(200), 10)).toBe("xxxxxxxxxx");
  });
});

describe("clampPageSize / clampPage", () => {
  it("defaults and bounds page size", () => {
    expect(clampPageSize(undefined)).toBe(MOD_PAGE_SIZE_DEFAULT);
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(999)).toBe(MOD_PAGE_SIZE_MAX);
    expect(clampPageSize(NaN)).toBe(MOD_PAGE_SIZE_DEFAULT);
    expect(clampPageSize(10)).toBe(10);
  });
  it("defaults and floors page index", () => {
    expect(clampPage(undefined)).toBe(1);
    expect(clampPage(0)).toBe(1);
    expect(clampPage(-3)).toBe(1);
    expect(clampPage(2.9)).toBe(2);
  });
});

describe("buildModQueue: aggregation of reports + flagged", () => {
  it("merges both streams and shows open by default, newest first", () => {
    const items = [
      item({ key: "r1", source: "report", targetId: "p1", createdAt: "2026-06-14T09:00:00.000Z" }),
      item({
        key: "flag:p2",
        source: "flag",
        targetId: "p2",
        label: "tip",
        reporter: null,
        createdAt: "2026-06-14T11:00:00.000Z",
      }),
    ];
    const res = buildModQueue(items, {});
    expect(res.total).toBe(2);
    expect(res.items.map((i) => i.key)).toEqual(["flag:p2", "r1"]); // newest first
  });

  it("de-dups: a post reported AND flagged appears only as the report", () => {
    const items = [
      item({ key: "r1", source: "report", targetId: "p1" }),
      item({ key: "flag:p1", source: "flag", targetId: "p1", label: "tip", reporter: null }),
    ];
    const res = buildModQueue(items, { source: "all" });
    expect(res.total).toBe(1);
    expect(res.items[0]!.source).toBe("report");
  });

  it("filters by source", () => {
    const items = [
      item({ key: "r1", source: "report", targetId: "p1" }),
      item({ key: "flag:p2", source: "flag", targetId: "p2", reporter: null }),
    ];
    expect(buildModQueue(items, { source: "report" }).total).toBe(1);
    expect(buildModQueue(items, { source: "flag" }).total).toBe(1);
  });

  it("filters by status (open vs actioned vs all)", () => {
    const items = [
      item({ key: "r1", status: "open", targetId: "p1" }),
      item({ key: "r2", status: "actioned", targetId: "p2" }),
    ];
    expect(buildModQueue(items, { status: "open" }).total).toBe(1);
    expect(buildModQueue(items, { status: "actioned" }).total).toBe(1);
    expect(buildModQueue(items, { status: "all" }).total).toBe(2);
  });

  it("sorts oldest first when asked", () => {
    const items = [
      item({ key: "a", targetId: "p1", createdAt: "2026-06-14T09:00:00.000Z" }),
      item({ key: "b", targetId: "p2", createdAt: "2026-06-14T11:00:00.000Z" }),
    ];
    expect(buildModQueue(items, { sort: "oldest" }).items.map((i) => i.key)).toEqual(["a", "b"]);
  });

  it("paginates", () => {
    const items = Array.from({ length: 25 }, (_, n) =>
      item({
        key: `r${n}`,
        targetId: `p${n}`,
        createdAt: `2026-06-14T10:00:${String(n).padStart(2, "0")}.000Z`,
      })
    );
    const p1 = buildModQueue(items, { page: 1, pageSize: 10 });
    expect(p1.items).toHaveLength(10);
    expect(p1.pageCount).toBe(3);
    expect(p1.total).toBe(25);
    const p3 = buildModQueue(items, { page: 3, pageSize: 10 });
    expect(p3.items).toHaveLength(5);
  });
});

describe("countOpen", () => {
  it("counts open reports and flags separately, ignoring actioned + de-duped flags", () => {
    const items = [
      item({ key: "r1", source: "report", status: "open", targetId: "p1" }),
      item({ key: "r2", source: "report", status: "actioned", targetId: "p2" }),
      item({ key: "flag:p3", source: "flag", status: "open", targetId: "p3", reporter: null }),
      // flag on p1 collapses into the report on p1 — not counted as a flag.
      item({ key: "flag:p1", source: "flag", status: "open", targetId: "p1", reporter: null }),
    ];
    expect(countOpen(items)).toEqual({ reports: 1, flags: 1 });
  });
});
