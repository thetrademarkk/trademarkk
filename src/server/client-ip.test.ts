import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

const reqWith = (xff: string | null) =>
  new Request(
    "https://x.test/api",
    xff === null ? undefined : { headers: { "x-forwarded-for": xff } }
  );

describe("clientIp — x-forwarded-for normalization", () => {
  it("returns the first hop when present", () => {
    expect(clientIp(reqWith("203.0.113.7, 10.0.0.1"))).toBe("203.0.113.7");
  });

  it("trims surrounding whitespace from the first hop", () => {
    expect(clientIp(reqWith("  203.0.113.7  , 10.0.0.1"))).toBe("203.0.113.7");
  });

  it("falls back to 'anon' when the header is missing", () => {
    expect(clientIp(reqWith(null))).toBe("anon");
  });

  it("falls back to 'anon' for an empty header (not nullish — the original bug)", () => {
    expect(clientIp(reqWith(""))).toBe("anon");
  });

  it("falls back to 'anon' for a whitespace-only header", () => {
    expect(clientIp(reqWith("   "))).toBe("anon");
  });

  it("falls back to 'anon' for a leading empty hop", () => {
    // `", 10.0.0.1".split(",")[0].trim()` is "" — must not collapse onto one key.
    expect(clientIp(reqWith(", 10.0.0.1"))).toBe("anon");
  });
});
