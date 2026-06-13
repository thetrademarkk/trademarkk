import { describe, expect, it } from "vitest";
import { isBlockedAddress, isHostAllowed, isPrivateIpv4, isPrivateIpv6 } from "./ssrf";

describe("isPrivateIpv4 — blocks every private/reserved range", () => {
  it("blocks 0.0.0.0/8 (this host)", () => {
    expect(isPrivateIpv4("0.0.0.0")).toBe(true);
    expect(isPrivateIpv4("0.1.2.3")).toBe(true);
  });
  it("blocks 10.0.0.0/8", () => {
    expect(isPrivateIpv4("10.0.0.1")).toBe(true);
    expect(isPrivateIpv4("10.255.255.255")).toBe(true);
  });
  it("blocks 127.0.0.0/8 (loopback)", () => {
    expect(isPrivateIpv4("127.0.0.1")).toBe(true);
    expect(isPrivateIpv4("127.99.1.1")).toBe(true);
  });
  it("blocks 172.16.0.0/12 (and not 172.15 / 172.32)", () => {
    expect(isPrivateIpv4("172.16.0.1")).toBe(true);
    expect(isPrivateIpv4("172.31.255.255")).toBe(true);
    expect(isPrivateIpv4("172.15.0.1")).toBe(false);
    expect(isPrivateIpv4("172.32.0.1")).toBe(false);
  });
  it("blocks 192.168.0.0/16", () => {
    expect(isPrivateIpv4("192.168.0.1")).toBe(true);
    expect(isPrivateIpv4("192.168.255.255")).toBe(true);
  });
  it("blocks 169.254.0.0/16 (link-local + cloud metadata 169.254.169.254)", () => {
    expect(isPrivateIpv4("169.254.169.254")).toBe(true);
    expect(isPrivateIpv4("169.254.0.1")).toBe(true);
  });
  it("blocks 100.64.0.0/10 (CGNAT) and TEST-NET / benchmarking / multicast", () => {
    expect(isPrivateIpv4("100.64.0.1")).toBe(true);
    expect(isPrivateIpv4("192.0.2.5")).toBe(true);
    expect(isPrivateIpv4("198.18.0.1")).toBe(true);
    expect(isPrivateIpv4("224.0.0.1")).toBe(true);
    expect(isPrivateIpv4("255.255.255.255")).toBe(true);
  });
  it("allows ordinary public IPv4", () => {
    expect(isPrivateIpv4("8.8.8.8")).toBe(false);
    expect(isPrivateIpv4("1.1.1.1")).toBe(false);
    expect(isPrivateIpv4("142.250.183.110")).toBe(false);
  });
  it("treats malformed / out-of-range as unsafe", () => {
    expect(isPrivateIpv4("999.1.1.1")).toBe(true);
    expect(isPrivateIpv4("not.an.ip")).toBe(true);
    expect(isPrivateIpv4("10.0.0")).toBe(true);
  });
});

describe("isPrivateIpv6 — blocks loopback/link-local/ULA/mapped", () => {
  it("blocks ::1 (loopback) and :: (unspecified)", () => {
    expect(isPrivateIpv6("::1")).toBe(true);
    expect(isPrivateIpv6("::")).toBe(true);
    expect(isPrivateIpv6("0:0:0:0:0:0:0:1")).toBe(true);
  });
  it("blocks fc00::/7 (unique local)", () => {
    expect(isPrivateIpv6("fc00::1")).toBe(true);
    expect(isPrivateIpv6("fd12:3456::1")).toBe(true);
  });
  it("blocks fe80::/10 (link-local) and ff00::/8 (multicast)", () => {
    expect(isPrivateIpv6("fe80::1")).toBe(true);
    expect(isPrivateIpv6("ff02::1")).toBe(true);
  });
  it("blocks IPv4-mapped private addresses (::ffff:127.0.0.1)", () => {
    expect(isPrivateIpv6("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIpv6("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateIpv6("::ffff:10.0.0.1")).toBe(true);
  });
  it("allows public IPv6 (and public IPv4-mapped)", () => {
    expect(isPrivateIpv6("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateIpv6("::ffff:8.8.8.8")).toBe(false);
  });
  it("treats malformed as unsafe", () => {
    expect(isPrivateIpv6("gggg::1")).toBe(true);
    expect(isPrivateIpv6("1:2:3")).toBe(true);
  });
});

describe("isBlockedAddress — dispatches v4/v6", () => {
  it("blocks both families' private ranges", () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
  });
  it("allows public addresses of both families", () => {
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
  });
});

describe("isHostAllowed — optional allowlist", () => {
  it("allows anything when the list is unset (null)", () => {
    expect(isHostAllowed("anything.example.com", null)).toBe(true);
  });
  it("allows exact + www + subdomains of an allowlisted host", () => {
    const list = new Set(["example.com", "trusted.io"]);
    expect(isHostAllowed("example.com", list)).toBe(true);
    expect(isHostAllowed("www.example.com", list)).toBe(true);
    expect(isHostAllowed("blog.example.com", list)).toBe(true);
    expect(isHostAllowed("trusted.io", list)).toBe(true);
  });
  it("rejects a host not on the list", () => {
    const list = new Set(["example.com"]);
    expect(isHostAllowed("evil.com", list)).toBe(false);
    expect(isHostAllowed("notexample.com", list)).toBe(false);
  });
});
