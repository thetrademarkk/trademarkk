import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// serverEnv reads process.env at module-eval time, so pin the deployment origin
// and extension id BEFORE importing the module under test (done per-test via a
// fresh dynamic import after vi.resetModules()).
const AUTH_URL = "https://app.example.com";
const EXT_ORIGIN = "chrome-extension://abcdefghijklmnop";

async function loadIsAllowedOrigin() {
  vi.stubEnv("BETTER_AUTH_URL", AUTH_URL);
  vi.stubEnv("EXTENSION_ORIGIN", EXT_ORIGIN);
  vi.resetModules();
  return (await import("./origin-check")).isAllowedOrigin;
}

function reqWith(headers: Record<string, string>): Request {
  return new Request(AUTH_URL, { headers });
}

describe("isAllowedOrigin", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows a same-origin Origin matching the deployment", async () => {
    const isAllowedOrigin = await loadIsAllowedOrigin();
    expect(isAllowedOrigin(reqWith({ origin: AUTH_URL }))).toBe(true);
  });

  it("rejects a cross-origin Origin", async () => {
    const isAllowedOrigin = await loadIsAllowedOrigin();
    expect(isAllowedOrigin(reqWith({ origin: "https://evil.example.com" }))).toBe(false);
  });

  it("allows the pinned companion extension origin", async () => {
    const isAllowedOrigin = await loadIsAllowedOrigin();
    expect(isAllowedOrigin(reqWith({ origin: EXT_ORIGIN }))).toBe(true);
  });

  it("rejects a different chrome-extension origin", async () => {
    const isAllowedOrigin = await loadIsAllowedOrigin();
    expect(isAllowedOrigin(reqWith({ origin: "chrome-extension://zzzzzzzzzzzzzzzz" }))).toBe(false);
  });

  it("rejects a malformed Origin header", async () => {
    const isAllowedOrigin = await loadIsAllowedOrigin();
    expect(isAllowedOrigin(reqWith({ origin: "not a url" }))).toBe(false);
  });

  // Absent Origin: fall back to Sec-Fetch-Site before defaulting to allow.
  it("allows when Origin is absent and no Sec-Fetch-Site is present (non-browser client)", async () => {
    const isAllowedOrigin = await loadIsAllowedOrigin();
    expect(isAllowedOrigin(reqWith({}))).toBe(true);
  });

  it("allows when Origin is absent but Sec-Fetch-Site is same-origin", async () => {
    const isAllowedOrigin = await loadIsAllowedOrigin();
    expect(isAllowedOrigin(reqWith({ "sec-fetch-site": "same-origin" }))).toBe(true);
  });

  it("allows when Origin is absent but Sec-Fetch-Site is none (address-bar nav)", async () => {
    const isAllowedOrigin = await loadIsAllowedOrigin();
    expect(isAllowedOrigin(reqWith({ "sec-fetch-site": "none" }))).toBe(true);
  });

  it("rejects when Origin is absent and Sec-Fetch-Site is cross-site", async () => {
    const isAllowedOrigin = await loadIsAllowedOrigin();
    expect(isAllowedOrigin(reqWith({ "sec-fetch-site": "cross-site" }))).toBe(false);
  });

  it("rejects when Origin is absent and Sec-Fetch-Site is same-site", async () => {
    const isAllowedOrigin = await loadIsAllowedOrigin();
    expect(isAllowedOrigin(reqWith({ "sec-fetch-site": "same-site" }))).toBe(false);
  });
});
