import { describe, expect, it } from "vitest";
import {
  extractFirstLink,
  isHttpsUrl,
  isUnfurlFresh,
  parseOgMeta,
  UNFURL_TTL_MS,
  urlHash,
} from "./unfurl";

describe("extractFirstLink (first-link-only extraction)", () => {
  it("returns the first link when several are present", () => {
    const body = "look at https://a.example.com and also https://b.example.com please";
    expect(extractFirstLink(body)).toBe("https://a.example.com");
  });
  it("returns null when there is no link", () => {
    expect(extractFirstLink("no links here at all")).toBeNull();
    expect(extractFirstLink("")).toBeNull();
  });
  it("strips trailing sentence punctuation", () => {
    expect(extractFirstLink("see https://example.com/path.")).toBe("https://example.com/path");
    expect(extractFirstLink("(https://example.com)")).toBe("https://example.com");
    expect(extractFirstLink("ref: https://example.com/x?y=1!")).toBe("https://example.com/x?y=1");
  });
  it("keeps an http link as the first match (the SSRF guard rejects it later)", () => {
    expect(extractFirstLink("http://example.com first")).toBe("http://example.com");
  });
  it("ignores an @ or $ token that is not a URL", () => {
    expect(extractFirstLink("@trader said $NIFTY rocks")).toBeNull();
  });
});

describe("isHttpsUrl", () => {
  it("accepts only valid absolute https URLs", () => {
    expect(isHttpsUrl("https://example.com")).toBe(true);
    expect(isHttpsUrl("http://example.com")).toBe(false);
    expect(isHttpsUrl("ftp://example.com")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("not a url")).toBe(false);
  });
});

describe("urlHash", () => {
  it("is stable and differs per URL", () => {
    expect(urlHash("https://example.com")).toBe(urlHash("https://example.com"));
    expect(urlHash("https://example.com")).not.toBe(urlHash("https://example.org"));
  });
  it("is an 8-char hex string", () => {
    expect(urlHash("https://example.com")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("isUnfurlFresh (cache TTL)", () => {
  const base = Date.parse("2026-06-13T00:00:00.000Z");
  it("is fresh within the TTL", () => {
    const fetchedAt = new Date(base).toISOString();
    expect(isUnfurlFresh(fetchedAt, base + UNFURL_TTL_MS - 1)).toBe(true);
  });
  it("is stale at/after the TTL boundary", () => {
    const fetchedAt = new Date(base).toISOString();
    expect(isUnfurlFresh(fetchedAt, base + UNFURL_TTL_MS)).toBe(false);
    expect(isUnfurlFresh(fetchedAt, base + UNFURL_TTL_MS + 5000)).toBe(false);
  });
  it("treats an unparseable timestamp as stale", () => {
    expect(isUnfurlFresh("not-a-date")).toBe(false);
  });
  it("honours a custom TTL", () => {
    const fetchedAt = new Date(base).toISOString();
    expect(isUnfurlFresh(fetchedAt, base + 500, 1000)).toBe(true);
    expect(isUnfurlFresh(fetchedAt, base + 1500, 1000)).toBe(false);
  });
});

describe("parseOgMeta (OG/twitter meta parse + sanitization)", () => {
  const url = "https://news.example.com/article/42";

  it("extracts og:title / og:description / og:image / og:site_name", () => {
    const html = `<html><head>
      <meta property="og:title" content="Big NIFTY breakout" />
      <meta property="og:description" content="A clean analysis of the move." />
      <meta property="og:image" content="https://cdn.example.com/cover.jpg" />
      <meta property="og:site_name" content="Example News" />
    </head><body>ignored</body></html>`;
    const u = parseOgMeta(html, url);
    expect(u).not.toBeNull();
    expect(u!.title).toBe("Big NIFTY breakout");
    expect(u!.description).toBe("A clean analysis of the move.");
    expect(u!.image).toBe("https://cdn.example.com/cover.jpg");
    expect(u!.siteName).toBe("Example News");
    expect(u!.url).toBe(url);
    expect(typeof u!.fetchedAt).toBe("string");
  });

  it("falls back to twitter:* and then <title> / host", () => {
    const html = `<html><head>
      <title>Plain Title</title>
      <meta name="twitter:description" content="Tw desc" />
    </head></html>`;
    const u = parseOgMeta(html, url);
    expect(u!.title).toBe("Plain Title");
    expect(u!.description).toBe("Tw desc");
    expect(u!.siteName).toBe("news.example.com"); // host fallback (www stripped)
    expect(u!.image).toBeNull();
  });

  it("matches meta tags in either attribute order", () => {
    const html = `<head><meta content="Reversed" property="og:title"></head>`;
    expect(parseOgMeta(html, url)!.title).toBe("Reversed");
  });

  it("decodes HTML entities and strips control chars (no raw markup)", () => {
    const html = `<head><meta property="og:title" content="A &amp; B &lt;tag&gt; &#39;q&#39;"></head>`;
    const u = parseOgMeta(html, url);
    expect(u!.title).toBe("A & B tag 'q'"); // < > dropped, & and ' decoded
    expect(u!.title).not.toContain("<");
  });

  it("resolves a relative og:image against the page URL, https-only", () => {
    const rel = parseOgMeta(
      `<head><meta property="og:title" content="t"><meta property="og:image" content="/img/c.png"></head>`,
      url
    );
    expect(rel!.image).toBe("https://news.example.com/img/c.png");
    const proto = parseOgMeta(
      `<head><meta property="og:title" content="t"><meta property="og:image" content="//cdn.example.com/c.png"></head>`,
      url
    );
    expect(proto!.image).toBe("https://cdn.example.com/c.png");
  });

  it("drops a non-https (http / data) og:image", () => {
    const httpImg = parseOgMeta(
      `<head><meta property="og:title" content="t"><meta property="og:image" content="http://cdn.example.com/c.png"></head>`,
      url
    );
    expect(httpImg!.image).toBeNull();
    const dataImg = parseOgMeta(
      `<head><meta property="og:title" content="t"><meta property="og:image" content="data:image/png;base64,AAAA"></head>`,
      url
    );
    expect(dataImg!.image).toBeNull();
  });

  it("returns null when there is no title at all", () => {
    expect(
      parseOgMeta(`<head><meta property="og:description" content="d"></head>`, url)
    ).toBeNull();
    expect(parseOgMeta(`<html><body>nothing</body></html>`, url)).toBeNull();
  });

  it("truncates an over-long title", () => {
    const long = "x".repeat(500);
    const u = parseOgMeta(`<head><meta property="og:title" content="${long}"></head>`, url);
    expect(u!.title!.length).toBeLessThanOrEqual(201); // 200 + ellipsis
    expect(u!.title!.endsWith("…")).toBe(true);
  });
});
