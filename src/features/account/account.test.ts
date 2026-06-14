import { describe, it, expect } from "vitest";
import {
  PROTECTED_ACCOUNT_EMAILS,
  isProtectedAccount,
  normalizeEmail,
  validateChangePassword,
  validateNewEmail,
  nextEmailChangeState,
  formatBackupCodes,
  backupCodesFilename,
  isDeleteConfirmed,
  DELETE_CONFIRM_PHRASE,
  describeUserAgent,
} from "./account";

describe("protected-account guard", () => {
  it("flags every protected account, case/space-insensitively", () => {
    for (const e of PROTECTED_ACCOUNT_EMAILS) {
      expect(isProtectedAccount(e)).toBe(true);
      expect(isProtectedAccount(e.toUpperCase())).toBe(true);
      expect(isProtectedAccount(`  ${e}  `)).toBe(true);
    }
  });

  it("never flags an ordinary or empty email", () => {
    expect(isProtectedAccount("someone@example.com")).toBe(false);
    expect(isProtectedAccount("e2e-acct-123@example.com")).toBe(false);
    expect(isProtectedAccount("")).toBe(false);
    expect(isProtectedAccount(null)).toBe(false);
    expect(isProtectedAccount(undefined)).toBe(false);
  });

  it("includes the demo + owner accounts", () => {
    expect(PROTECTED_ACCOUNT_EMAILS).toContain("demo@trademark.app");
    expect(PROTECTED_ACCOUNT_EMAILS).toContain("raashish1601@gmail.com");
    expect(PROTECTED_ACCOUNT_EMAILS).toContain("mahajandeepakshi03@gmail.com");
  });

  it("normalizeEmail lowercases and trims", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
  });
});

describe("validateChangePassword", () => {
  const base = {
    currentPassword: "oldPassw0rd",
    newPassword: "newStrongPass1",
    confirmPassword: "newStrongPass1",
  };

  it("accepts a valid change", () => {
    expect(validateChangePassword(base)).toEqual({ ok: true });
  });

  it("requires the current password", () => {
    const r = validateChangePassword({ ...base, currentPassword: "" });
    expect(r.ok).toBe(false);
  });

  it("rejects a too-short new password (shared strength rules)", () => {
    const r = validateChangePassword({ ...base, newPassword: "short", confirmPassword: "short" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/at least/i);
  });

  it("rejects reusing the current password", () => {
    const r = validateChangePassword({
      currentPassword: "samePass123",
      newPassword: "samePass123",
      confirmPassword: "samePass123",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/different/i);
  });

  it("rejects a mismatched confirmation", () => {
    const r = validateChangePassword({ ...base, confirmPassword: "different1234" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/don't match/i);
  });
});

describe("validateNewEmail + state machine", () => {
  it("accepts a valid, different email", () => {
    expect(validateNewEmail("a@old.com", "b@new.com")).toEqual({ ok: true });
  });

  it("rejects an empty / malformed email", () => {
    expect(validateNewEmail("a@old.com", "").ok).toBe(false);
    expect(validateNewEmail("a@old.com", "not-an-email").ok).toBe(false);
    expect(validateNewEmail("a@old.com", "no@dotcom").ok).toBe(false);
  });

  it("rejects the same email (case-insensitive)", () => {
    expect(validateNewEmail("Me@Example.com", "me@example.com").ok).toBe(false);
  });

  it("transitions to pending on success and error on failure", () => {
    const ok = validateNewEmail("a@old.com", "B@New.com");
    expect(nextEmailChangeState(ok, "B@New.com")).toEqual({
      status: "pending",
      pendingEmail: "b@new.com",
    });
    const bad = validateNewEmail("a@old.com", "");
    const state = nextEmailChangeState(bad, "");
    expect(state.status).toBe("error");
  });
});

describe("backup-code formatting", () => {
  it("renders one code per line with a header, trimming blanks", () => {
    const out = formatBackupCodes(["AAAA-1111", " BBBB-2222 ", "", "CCCC-3333"]);
    const lines = out.split("\n");
    expect(lines).toContain("AAAA-1111");
    expect(lines).toContain("BBBB-2222");
    expect(lines).toContain("CCCC-3333");
    // The empty input code is dropped, not rendered as a blank data line.
    const dataLines = lines.filter((l) => /^[A-Z0-9-]+$/.test(l));
    expect(dataLines).toHaveLength(3);
    expect(out).toMatch(/backup codes/i);
  });

  it("date-stamps and brand-prefixes the filename", () => {
    const name = backupCodesFilename(new Date("2026-06-14T10:00:00Z"));
    expect(name).toBe("trademarkk-backup-codes-2026-06-14.txt");
  });
});

describe("describeUserAgent", () => {
  it("names common browser + OS pairs", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
      )
    ).toBe("Chrome on Windows");
    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1"
      )
    ).toBe("Safari on iOS");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Edg/120.0")).toBe(
      "Edge on Windows"
    );
  });

  it("falls back gracefully for empty / unknown UAs", () => {
    expect(describeUserAgent("")).toBe("Unknown device");
    expect(describeUserAgent(null)).toBe("Unknown device");
    expect(describeUserAgent("some-bot/1.0")).toBe("Unknown device");
  });
});

describe("delete confirmation", () => {
  it("requires the exact phrase", () => {
    expect(isDeleteConfirmed(DELETE_CONFIRM_PHRASE)).toBe(true);
    expect(isDeleteConfirmed("  DELETE  ")).toBe(true);
    expect(isDeleteConfirmed("delete")).toBe(false);
    expect(isDeleteConfirmed("DELETE NOW")).toBe(false);
    expect(isDeleteConfirmed("")).toBe(false);
  });
});
