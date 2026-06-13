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

import { fetchUnfurl } from "./unfurl";
import { assertSafeUrl } from "./ssrf";

const PUBLIC = [{ address: "93.184.216.34", family: 4 }];
const PRIVATE = [{ address: "169.254.169.254", family: 4 }];

function htmlResponse(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}
function redirectResponse(location: string): Response {
  return new Response(null, { status: 301, headers: { location } });
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  lookupMock.mockReset();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("assertSafeUrl (https + DNS resolution + IP blocklist)", () => {
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
  it("accepts a host resolving to a public IP", async () => {
    lookupMock.mockResolvedValue(PUBLIC);
    const r = await assertSafeUrl("https://example.com/page");
    expect(r.ok).toBe(true);
  });
  it("rejects when ANY resolved address is private (mixed round-robin)", async () => {
    lookupMock.mockResolvedValue([...PUBLIC, ...PRIVATE]);
    const r = await assertSafeUrl("https://mixed.example.com");
    expect(r.ok).toBe(false);
  });
});

describe("fetchUnfurl — SSRF-safe fetch + redirect handling", () => {
  it("fetches and parses OG meta from a safe public URL", async () => {
    lookupMock.mockResolvedValue(PUBLIC);
    globalThis.fetch = vi.fn(async () =>
      htmlResponse(
        `<head><meta property="og:title" content="Hello"><meta property="og:site_name" content="Site"></head>`
      )
    ) as unknown as typeof fetch;

    const u = await fetchUnfurl("https://example.com/a");
    expect(u).not.toBeNull();
    expect(u!.title).toBe("Hello");
    expect(u!.siteName).toBe("Site");
  });

  it("BLOCKS a redirect that points at a private host (no fetch of the private URL)", async () => {
    // First host is public; it 301s to a metadata-IP host which DNS-resolves private.
    lookupMock.mockImplementation(async (host: string) =>
      host === "evil.example.com" ? PRIVATE : PUBLIC
    );
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.startsWith("https://public.example.com")) {
        return redirectResponse("https://evil.example.com/secret");
      }
      // If we ever reach here the SSRF guard failed — surface it loudly.
      return htmlResponse(`<head><meta property="og:title" content="LEAKED"></head>`);
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const u = await fetchUnfurl("https://public.example.com/start");
    expect(u).toBeNull();
    // The private destination must NEVER have been fetched.
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("evil.example.com"))).toBe(false);
  });

  it("returns null for a non-HTML content-type", async () => {
    lookupMock.mockResolvedValue(PUBLIC);
    globalThis.fetch = vi.fn(
      async () =>
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    ) as unknown as typeof fetch;
    expect(await fetchUnfurl("https://example.com/api")).toBeNull();
  });

  it("returns null when the page has no title", async () => {
    lookupMock.mockResolvedValue(PUBLIC);
    globalThis.fetch = vi.fn(async () =>
      htmlResponse(`<head><meta property="og:description" content="d"></head>`)
    ) as unknown as typeof fetch;
    expect(await fetchUnfurl("https://example.com/x")).toBeNull();
  });

  it("returns null (never throws) when the fetch errors", async () => {
    lookupMock.mockResolvedValue(PUBLIC);
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(fetchUnfurl("https://example.com/x")).resolves.toBeNull();
  });
});
