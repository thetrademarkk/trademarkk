import { describe, it, expect } from "vitest";
import {
  sanitizeTemplate,
  sanitizeTemplates,
  applyTemplate,
  upsertTemplate,
  renameTemplate,
  deleteTemplate,
  MAX_TEMPLATES,
  type NoteTemplate,
} from "./templates";

const tmpl = (over: Partial<NoteTemplate> = {}): NoteTemplate => ({
  id: "1",
  name: "3MA breakout",
  notes: "Wait for 3MA cross + retest.",
  playbookId: "pb1",
  confidence: 4,
  createdAt: "2026-06-13T00:00:00.000Z",
  ...over,
});

describe("sanitizeTemplate", () => {
  it("accepts a full template", () => {
    expect(sanitizeTemplate(tmpl())?.name).toBe("3MA breakout");
  });
  it("rejects an empty name", () => {
    expect(sanitizeTemplate({ ...tmpl(), name: "   " })).toBeNull();
  });
  it("rejects an all-empty template (nothing to fill)", () => {
    expect(
      sanitizeTemplate({ name: "x", notes: "", playbookId: "", confidence: undefined })
    ).toBeNull();
  });
  it("keeps a notes-only template", () => {
    const t = sanitizeTemplate({ name: "n", notes: "hi" });
    expect(t).not.toBeNull();
    expect(t?.playbookId).toBeUndefined();
  });
  it("clamps confidence to 1..5 (drops out-of-range)", () => {
    expect(sanitizeTemplate({ name: "n", confidence: 9 })?.confidence).toBeUndefined();
    expect(sanitizeTemplate({ name: "n", confidence: 3.4 })?.confidence).toBe(3);
  });
  it("trims and caps the name length", () => {
    const long = "a".repeat(200);
    expect(sanitizeTemplate({ name: long, notes: "x" })?.name.length).toBe(60);
  });
});

describe("sanitizeTemplates", () => {
  it("drops junk and caps the count", () => {
    const raw = [tmpl(), { name: "" }, null, 5, { name: "ok", notes: "n" }];
    expect(sanitizeTemplates(raw)).toHaveLength(2);
  });
  it("returns [] for non-arrays", () => {
    expect(sanitizeTemplates("nope")).toEqual([]);
  });
  it("respects MAX_TEMPLATES", () => {
    const many = Array.from({ length: MAX_TEMPLATES + 10 }, (_, i) => tmpl({ name: `t${i}` }));
    expect(sanitizeTemplates(many)).toHaveLength(MAX_TEMPLATES);
  });
});

describe("applyTemplate", () => {
  it("maps notes + playbook + confidence onto a form patch", () => {
    const patch = applyTemplate(tmpl());
    expect(patch).toEqual({
      notes: "Wait for 3MA cross + retest.",
      playbookId: "pb1",
      confidence: 4,
    });
  });
  it("always sets notes (clears when template notes empty)", () => {
    const patch = applyTemplate(tmpl({ notes: "", playbookId: undefined, confidence: 2 }));
    expect(patch.notes).toBe("");
    expect("playbookId" in patch).toBe(false);
    expect(patch.confidence).toBe(2);
  });
  it("omits playbook/confidence when absent", () => {
    const patch = applyTemplate(tmpl({ playbookId: undefined, confidence: undefined }));
    expect("playbookId" in patch).toBe(false);
    expect("confidence" in patch).toBe(false);
  });
});

describe("upsertTemplate", () => {
  it("adds a new template at the front", () => {
    const next = upsertTemplate([], { name: "ORB", notes: "open range" });
    expect(next).toHaveLength(1);
    expect(next[0]!.name).toBe("ORB");
  });
  it("updates by case-insensitive name instead of duplicating", () => {
    const start = [tmpl({ id: "1", name: "ORB", notes: "old" })];
    const next = upsertTemplate(start, { name: "orb", notes: "new" });
    expect(next).toHaveLength(1);
    expect(next[0]!.notes).toBe("new");
    expect(next[0]!.id).toBe("1");
  });
  it("updates by id (a rename keeps the row)", () => {
    const start = [tmpl({ id: "1", name: "ORB" })];
    const next = upsertTemplate(start, { id: "1", name: "ORB v2", notes: "x" });
    expect(next).toHaveLength(1);
    expect(next[0]!.name).toBe("ORB v2");
  });
  it("ignores an all-empty input", () => {
    const start = [tmpl()];
    expect(upsertTemplate(start, { name: "y", notes: "" })).toBe(start);
  });
});

describe("renameTemplate", () => {
  it("renames by id", () => {
    const next = renameTemplate([tmpl({ id: "1", name: "a" })], "1", "b");
    expect(next[0]!.name).toBe("b");
  });
  it("refuses a name collision with another template", () => {
    const start = [tmpl({ id: "1", name: "a" }), tmpl({ id: "2", name: "b" })];
    expect(renameTemplate(start, "1", "B")).toBe(start);
  });
  it("ignores empty names", () => {
    const start = [tmpl({ id: "1", name: "a" })];
    expect(renameTemplate(start, "1", "   ")).toBe(start);
  });
});

describe("deleteTemplate", () => {
  it("removes by id", () => {
    const next = deleteTemplate([tmpl({ id: "1" }), tmpl({ id: "2" })], "1");
    expect(next.map((t) => t.id)).toEqual(["2"]);
  });
});
