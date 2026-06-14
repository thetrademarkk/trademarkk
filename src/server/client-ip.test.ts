import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

const reqWith = (headers: Record<string, string> | null) =>
  new Request("https://x.test/api", headers === null ? undefined : { headers });

const xff = (value: string) => reqWith({ "x-forwarded-for": value });

describe("clientIp — trusted client IP for rate-limit keys", () => {
  it("prefers x-real-ip (platform-injected, trusted) over x-forwarded-for", () => {
    const req = reqWith({
      "x-real-ip": "198.51.100.9",
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
    });
    expect(clientIp(req)).toBe("198.51.100.9");
  });

  it("trims surrounding whitespace from x-real-ip", () => {
    expect(clientIp(reqWith({ "x-real-ip": "  198.51.100.9  " }))).toBe("198.51.100.9");
  });

  it("uses the LAST x-forwarded-for hop (the platform-appended edge peer)", () => {
    // `client, proxy, edge` — the last hop is the trusted, platform-controlled one.
    expect(clientIp(xff("203.0.113.7, 10.0.0.1, 198.51.100.9"))).toBe("198.51.100.9");
  });

  it("ignores spoofed leading hops (anti-spoof: first hop is attacker-controlled)", () => {
    // Attacker prepends a fake IP; we must NOT key on it.
    expect(clientIp(xff("1.2.3.4, 198.51.100.9"))).not.toBe("1.2.3.4");
    expect(clientIp(xff("1.2.3.4, 198.51.100.9"))).toBe("198.51.100.9");
  });

  it("trims surrounding whitespace from the last hop", () => {
    expect(clientIp(xff("203.0.113.7 ,  198.51.100.9  "))).toBe("198.51.100.9");
  });

  it("uses the single hop when x-forwarded-for has only one entry", () => {
    expect(clientIp(xff("203.0.113.7"))).toBe("203.0.113.7");
  });

  it("falls back to the forwarded hop when x-real-ip is empty", () => {
    const req = reqWith({
      "x-real-ip": "   ",
      "x-forwarded-for": "203.0.113.7, 198.51.100.9",
    });
    expect(clientIp(req)).toBe("198.51.100.9");
  });

  it("falls back to 'anon' when no IP headers are present", () => {
    expect(clientIp(reqWith(null))).toBe("anon");
  });

  it("falls back to 'anon' for an empty x-forwarded-for header (not nullish — the original bug)", () => {
    expect(clientIp(xff(""))).toBe("anon");
  });

  it("falls back to 'anon' for a whitespace-only x-forwarded-for header", () => {
    expect(clientIp(xff("   "))).toBe("anon");
  });

  it("falls back to 'anon' when the trusted (last) hop is empty", () => {
    // `"10.0.0.1, ".split(",").at(-1).trim()` is "" — must not collapse onto one key.
    expect(clientIp(xff("10.0.0.1, "))).toBe("anon");
  });
});
