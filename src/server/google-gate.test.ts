import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Google "is it enabled?" gate is the linchpin of the GATED rollout: the
 * provider is registered AND the button shows ONLY when both creds are present.
 * `serverEnv` snapshots process.env at module load, so each case resets modules
 * and re-imports with the env it wants.
 */
describe("hasGoogle() env gate", () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("is false when neither credential is set (Google stays hidden)", async () => {
    const { hasGoogle } = await import("./env");
    expect(hasGoogle()).toBe(false);
  });

  it("is false when only the client id is set", async () => {
    process.env.GOOGLE_CLIENT_ID = "id-only";
    const { hasGoogle } = await import("./env");
    expect(hasGoogle()).toBe(false);
  });

  it("is false when only the client secret is set", async () => {
    process.env.GOOGLE_CLIENT_SECRET = "secret-only";
    const { hasGoogle } = await import("./env");
    expect(hasGoogle()).toBe(false);
  });

  it("is true ONLY when both credentials are present", async () => {
    process.env.GOOGLE_CLIENT_ID = "real-id";
    process.env.GOOGLE_CLIENT_SECRET = "real-secret";
    const { hasGoogle } = await import("./env");
    expect(hasGoogle()).toBe(true);
  });
});
