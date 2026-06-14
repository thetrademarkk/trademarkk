import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock DNS so the SSRF guard resolves deterministic addresses without network.
const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

// Mock the platform DB out — these tests target the fetch/redirect/SSRF path,
// not caching (cache TTL is covered purely in features/community/unfurl.test.ts).
vi.mock("./db/platform", () => ({
  platformDb: {
    select: () => ({ from: () => ({ where: () => ({ get: async () => undefined }) }) }),
    insert: () => ({
      values: () => ({ onConflictDoUpdate: () => ({ catch: async () => undefined }) }),
    }),
  },
}));

import { __setPinnedTransport, fetchUnfurl } from "./unfurl";
import { assertSafeUrl, type SafeTarget } from "./ssrf";

const PUBLIC = [{ address: "93.184.216.34", family: 4 }];
const PUBLIC_IP = "93.184.216.34";
const PRIVATE = [{ address: "169.254.169.254", family: 4 }];
const PRIVATE_IP = "169.254.169.254";

function htmlResponse(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}
function redirectResponse(location: string): Response {
  return new Response(null, { status: 301, headers: { location } });
}

/**
 * Installs a fake pinned transport and records the EXACT IP each call was asked
 * to dial (target.addresses[0].address) alongside the URL. This is what proves
 * validation-IP === connection-IP: the transport can only ever receive the
 * address(es) assertSafeUrl already validated for that hop.
 */
function installTransport(handler: (target: SafeTarget) => Response | Promise<Response>): {
  dialled: { ip: string; url: string }[];
  restore: () => void;
} {
  const dialled: { ip: string; url: string }[] = [];
  const restore = __setPinnedTransport(async (target) => {
    dialled.push({ ip: target.addresses[0]!.address, url: target.url.toString() });
    return await handler(target);
  });
  return { dialled, restore };
}

let restoreTransport: (() => void) | undefined;

beforeEach(() => {
  lookupMock.mockReset();
});
afterEach(() => {
  restoreTransport?.();
  restoreTransport = undefined;
  vi.restoreAllMocks();
});

describe("assertSafeUrl (https + DNS resolution + IP blocklist + pinning)", () => {
  it("rejects non-https schemes outright (no DNS)", async () => {
    const r = await assertSafeUrl("http://example.com");
    expect(r.ok).toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });
  it("rejects a host that resolves to a private IP", async () => {
    lookupMock.mockResolvedValue(PRIVATE);
    const r = await assertSafeUrl("https://internal.example.com");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("private-ip");
  });
  it("rejects a literal private-IP host without DNS", async () => {
    const r = await assertSafeUrl("https://127.0.0.1/x");
    expect(r.ok).toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });
  it("accepts a host resolving to a public IP and returns it as the pinned address", async () => {
    lookupMock.mockResolvedValue(PUBLIC);
    const r = await assertSafeUrl("https://example.com/page");
    expect(r.ok).toBe(true);
    // The validated address is returned so the connection can pin to it.
    if (r.ok) expect(r.addresses).toEqual([{ address: PUBLIC_IP, family: 4 }]);
  });
  it("pins a literal public-IP host to itself", async () => {
    const r = await assertSafeUrl("https://93.184.216.34/page");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.addresses).toEqual([{ address: PUBLIC_IP, family: 4 }]);
    expect(lookupMock).not.toHaveBeenCalled();
  });
  it("rejects when ANY resolved address is private (mixed round-robin)", async () => {
    lookupMock.mockResolvedValue([...PUBLIC, ...PRIVATE]);
    const r = await assertSafeUrl("https://mixed.example.com");
    expect(r.ok).toBe(false);
  });
});

describe("fetchUnfurl — SSRF-safe, IP-pinned fetch + redirect handling", () => {
  it("fetches and parses OG meta from a safe public URL (connects to the validated IP)", async () => {
    lookupMock.mockResolvedValue(PUBLIC);
    const t = installTransport(() =>
      htmlResponse(
        `<head><meta property="og:title" content="Hello"><meta property="og:site_name" content="Site"></head>`
      )
    );
    restoreTransport = t.restore;

    const u = await fetchUnfurl("https://example.com/a");
    expect(u).not.toBeNull();
    expect(u!.title).toBe("Hello");
    expect(u!.siteName).toBe("Site");
    // (d) legit public URL unfurls AND the connection went to the validated IP.
    expect(t.dialled).toEqual([{ ip: PUBLIC_IP, url: "https://example.com/a" }]);
  });

  it("(a) rejects a host that resolves to a private IP — transport is never dialled", async () => {
    lookupMock.mockResolvedValue(PRIVATE);
    const t = installTransport(() => {
      throw new Error("transport must not be called for a private host");
    });
    restoreTransport = t.restore;

    expect(await fetchUnfurl("https://internal.example.com/x")).toBeNull();
    expect(t.dialled).toEqual([]); // never connected
  });

  it("(b) BLOCKS DNS rebinding: validator saw public, connect-time would re-resolve private — but we pin", async () => {
    // The host resolves PUBLIC at validation time (this is the only resolution
    // that ever runs). A rebinding attacker would flip the host to a private IP
    // for the *connect-time* resolution — but there is no second resolution:
    // the transport can only receive the pre-validated PUBLIC address. We assert
    // exactly that, and that NO private IP is ever handed to the transport.
    lookupMock.mockResolvedValue(PUBLIC);
    const dialledIps: string[] = [];
    const restore = __setPinnedTransport(async (target) => {
      const ip = target.addresses[0]!.address;
      dialledIps.push(ip);
      // If the connection ever resolved to the private rebind target, it would
      // be a leak. Pinning guarantees this address is the validated PUBLIC one.
      if (ip === PRIVATE_IP) throw new Error("LEAK: connected to rebound private IP");
      return htmlResponse(`<head><meta property="og:title" content="ok"></head>`);
    });
    restoreTransport = restore;

    const u = await fetchUnfurl("https://rebind.example.com/x");
    expect(u).not.toBeNull();
    // Connection-IP is EXACTLY the validation-IP; the private rebind never reached.
    expect(dialledIps).toEqual([PUBLIC_IP]);
    expect(dialledIps).not.toContain(PRIVATE_IP);
    // DNS was resolved ONCE (validation) — there is no independent connect-time
    // resolution that an attacker could rebind.
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });

  it("(c) BLOCKS a redirect that points at a private host — re-validated + re-pinned per hop", async () => {
    // First host is public; it 301s to a metadata-IP host which DNS-resolves private.
    lookupMock.mockImplementation(async (host: string) =>
      host === "evil.example.com" ? PRIVATE : PUBLIC
    );
    const t = installTransport((target) => {
      if (target.url.hostname === "public.example.com") {
        return redirectResponse("https://evil.example.com/secret");
      }
      // If we ever reach here the SSRF guard failed — surface it loudly.
      return htmlResponse(`<head><meta property="og:title" content="LEAKED"></head>`);
    });
    restoreTransport = t.restore;

    const u = await fetchUnfurl("https://public.example.com/start");
    expect(u).toBeNull();
    // Only the first (public) hop was ever dialled; the private redirect target
    // was re-validated, rejected, and never connected to.
    expect(t.dialled).toEqual([{ ip: PUBLIC_IP, url: "https://public.example.com/start" }]);
    expect(t.dialled.some((d) => d.url.includes("evil.example.com"))).toBe(false);
  });

  it("follows a redirect to another PUBLIC host, re-pinning to the new validated IP", async () => {
    // 203.0.113.0/24 is TEST-NET-3 (blocked); use a clearly-public IP instead.
    const NEXT_PUBLIC = [{ address: "8.8.8.8", family: 4 }];
    lookupMock.mockImplementation(async (host: string) =>
      host === "second.example.com" ? NEXT_PUBLIC : PUBLIC
    );
    const t = installTransport((target) => {
      if (target.url.hostname === "first.example.com") {
        return redirectResponse("https://second.example.com/final");
      }
      return htmlResponse(`<head><meta property="og:title" content="Final"></head>`);
    });
    restoreTransport = t.restore;

    const u = await fetchUnfurl("https://first.example.com/start");
    expect(u).not.toBeNull();
    expect(u!.title).toBe("Final");
    // Hop 1 pinned to the first host's IP; hop 2 RE-PINNED to the second host's IP.
    expect(t.dialled).toEqual([
      { ip: PUBLIC_IP, url: "https://first.example.com/start" },
      { ip: "8.8.8.8", url: "https://second.example.com/final" },
    ]);
  });

  it("returns null for a non-HTML content-type", async () => {
    lookupMock.mockResolvedValue(PUBLIC);
    const t = installTransport(
      () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    );
    restoreTransport = t.restore;
    expect(await fetchUnfurl("https://example.com/api")).toBeNull();
  });

  it("returns null when the page has no title", async () => {
    lookupMock.mockResolvedValue(PUBLIC);
    const t = installTransport(() =>
      htmlResponse(`<head><meta property="og:description" content="d"></head>`)
    );
    restoreTransport = t.restore;
    expect(await fetchUnfurl("https://example.com/x")).toBeNull();
  });

  it("returns null (never throws) when the connection errors", async () => {
    lookupMock.mockResolvedValue(PUBLIC);
    const t = installTransport(() => {
      throw new Error("network down");
    });
    restoreTransport = t.restore;
    await expect(fetchUnfurl("https://example.com/x")).resolves.toBeNull();
  });
});
