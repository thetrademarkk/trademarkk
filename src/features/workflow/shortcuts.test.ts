import { describe, it, expect } from "vitest";
import {
  matchShortcut,
  isTypingTarget,
  shouldPreventDefault,
  shortcutHelpRows,
  type KeyLike,
  type TargetLike,
} from "./shortcuts";

const key = (over: Partial<KeyLike>): KeyLike => ({
  key: "a",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

const input: TargetLike = { tagName: "INPUT" };
const textarea: TargetLike = { tagName: "TEXTAREA" };
const editable: TargetLike = { isContentEditable: true };
const button: TargetLike = { tagName: "BUTTON" };

describe("isTypingTarget", () => {
  it("true for input/textarea/select", () => {
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(textarea)).toBe(true);
    expect(isTypingTarget({ tagName: "select" })).toBe(true);
  });
  it("true for contentEditable", () => {
    expect(isTypingTarget(editable)).toBe(true);
  });
  it("false for buttons and null", () => {
    expect(isTypingTarget(button)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });
});

describe("matchShortcut — Ctrl/Cmd+S (save)", () => {
  it("fires on Ctrl+S and Cmd+S", () => {
    expect(matchShortcut(key({ ctrlKey: true, key: "s" }), button)).toBe("save");
    expect(matchShortcut(key({ metaKey: true, key: "S" }), button)).toBe("save");
  });
  it("STILL fires while typing in a field (you save mid-edit)", () => {
    expect(matchShortcut(key({ ctrlKey: true, key: "s" }), input)).toBe("save");
    expect(matchShortcut(key({ ctrlKey: true, key: "s" }), textarea)).toBe("save");
  });
  it("does not fire with Alt also held", () => {
    expect(matchShortcut(key({ ctrlKey: true, altKey: true, key: "s" }), button)).toBeNull();
  });
});

describe("matchShortcut — Ctrl/Cmd+Q and +L", () => {
  it("Ctrl+Q → quickAdd when not typing", () => {
    expect(matchShortcut(key({ ctrlKey: true, key: "q" }), button)).toBe("quickAdd");
  });
  it("Ctrl+L → quickLog when not typing", () => {
    expect(matchShortcut(key({ metaKey: true, key: "l" }), button)).toBe("quickLog");
  });
  it("does NOT fire Q/L while typing (would clobber the field)", () => {
    expect(matchShortcut(key({ ctrlKey: true, key: "q" }), input)).toBeNull();
    expect(matchShortcut(key({ ctrlKey: true, key: "l" }), textarea)).toBeNull();
  });
  it("ignores Ctrl+Shift+Q (reserved for dev tools etc.)", () => {
    expect(matchShortcut(key({ ctrlKey: true, shiftKey: true, key: "q" }), button)).toBeNull();
  });
});

describe("matchShortcut — ? (help)", () => {
  it("fires on bare ? when not typing", () => {
    expect(matchShortcut(key({ key: "?", shiftKey: true }), button)).toBe("help");
  });
  it("also fires on Shift+/ (physical-key form)", () => {
    expect(matchShortcut(key({ key: "/", shiftKey: true }), button)).toBe("help");
  });
  it("does not fire on a plain / (no shift)", () => {
    expect(matchShortcut(key({ key: "/" }), button)).toBeNull();
  });
  it("does NOT fire while typing", () => {
    expect(matchShortcut(key({ key: "?", shiftKey: true }), input)).toBeNull();
  });
  it("does not fire when Ctrl/Cmd is held", () => {
    expect(matchShortcut(key({ key: "?", ctrlKey: true }), button)).toBeNull();
  });
});

describe("matchShortcut — no hijacking", () => {
  it("ignores plain letters (T/J are handled elsewhere)", () => {
    expect(matchShortcut(key({ key: "t" }), button)).toBeNull();
    expect(matchShortcut(key({ key: "a" }), button)).toBeNull();
  });
  it("ignores Ctrl+K (command palette owns it)", () => {
    expect(matchShortcut(key({ ctrlKey: true, key: "k" }), button)).toBeNull();
  });
});

describe("shouldPreventDefault", () => {
  it("prevents default for every mapped action", () => {
    for (const a of ["save", "quickAdd", "quickLog", "help"] as const) {
      expect(shouldPreventDefault(a)).toBe(true);
    }
  });
});

describe("shortcutHelpRows", () => {
  it("uses ⌘ on mac and Ctrl elsewhere", () => {
    expect(shortcutHelpRows(true).some((r) => r.keys.includes("⌘"))).toBe(true);
    expect(shortcutHelpRows(false).some((r) => r.keys.includes("Ctrl"))).toBe(true);
  });
  it("documents all primary shortcuts", () => {
    const labels = shortcutHelpRows(false).map((r) => r.label.toLowerCase());
    expect(labels.some((l) => l.includes("save"))).toBe(true);
    expect(labels.some((l) => l.includes("quick-add"))).toBe(true);
    expect(labels.some((l) => l.includes("quick-log"))).toBe(true);
  });
});
