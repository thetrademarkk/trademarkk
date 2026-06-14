import { describe, it, expect } from "vitest";
// Build-tooling helpers that inject a deploy-unique cache VERSION into
// public/sw.js. Pure + dependency-free so they can be unit-tested here even
// though the gen-sw build script that uses them is a node .mjs.
import {
  deriveSwVersion,
  injectSwVersion,
  SW_VERSION_PLACEHOLDER,
} from "../../scripts/sw-version.mjs";

describe("deriveSwVersion", () => {
  it("prefers the Vercel commit SHA (truncated to 12)", () => {
    const v = deriveSwVersion({
      env: { VERCEL_GIT_COMMIT_SHA: "0123456789abcdef0123456789" },
      buildId: "buildid",
      gitSha: "deadbeefcafe",
    });
    expect(v).toBe("tm-0123456789ab");
  });

  it("falls back to the Next buildId when no Vercel SHA", () => {
    const v = deriveSwVersion({ env: {}, buildId: "abc123buildid", gitSha: "deadbeefcafe" });
    expect(v).toBe("tm-abc123buildid");
  });

  it("falls back to the git SHA (truncated) when no buildId", () => {
    const v = deriveSwVersion({ env: {}, buildId: "", gitSha: "deadbeefcafe1234" });
    expect(v).toBe("tm-deadbeefcafe");
  });

  it("falls back to a timestamp when nothing else is available", () => {
    const v = deriveSwVersion({ env: {}, buildId: "", gitSha: "", now: () => 0 });
    expect(v).toBe("tm-0");
  });

  it("produces different versions for different commits (deploy-unique)", () => {
    const a = deriveSwVersion({ env: { VERCEL_GIT_COMMIT_SHA: "aaaaaaaaaaaa" } });
    const b = deriveSwVersion({ env: { VERCEL_GIT_COMMIT_SHA: "bbbbbbbbbbbb" } });
    expect(a).not.toBe(b);
  });

  it("trims whitespace from env values", () => {
    const v = deriveSwVersion({ env: { VERCEL_GIT_COMMIT_SHA: "  abcdef012345  " } });
    expect(v).toBe("tm-abcdef012345");
  });

  it("ignores empty-string sources and continues down the chain", () => {
    const v = deriveSwVersion({
      env: { VERCEL_GIT_COMMIT_SHA: "   " },
      buildId: "  ",
      gitSha: "feedface0000",
    });
    expect(v).toBe("tm-feedface0000");
  });
});

describe("injectSwVersion", () => {
  const src = `const VERSION = "${SW_VERSION_PLACEHOLDER}";\nconst PRECACHE = [];\n`;

  it("replaces the placeholder with the concrete version", () => {
    const out = injectSwVersion(src, "tm-deadbeef");
    expect(out).toContain('const VERSION = "tm-deadbeef";');
    expect(out).not.toContain(SW_VERSION_PLACEHOLDER);
  });

  it("is idempotent — re-injecting overwrites a prior version", () => {
    const once = injectSwVersion(src, "tm-aaa");
    const twice = injectSwVersion(once, "tm-bbb");
    expect(twice).toContain('const VERSION = "tm-bbb";');
    expect(twice).not.toContain("tm-aaa");
  });

  it("leaves the rest of the source untouched", () => {
    const out = injectSwVersion(src, "tm-xyz");
    expect(out).toContain("const PRECACHE = [];");
  });
});
