import { describe, expect, it, vi } from "vitest";
import { siteConfig } from "@/config/site";
import { POSTS } from "@/content/posts";

// The sitemap now pulls blog posts from listBlogPosts() (editorial + approved
// community submissions). That module imports the platform DB (server-only), so
// we mock it to the editorial-only fallback — exactly what it returns when the
// DB is unreachable (e.g. a CI build with placeholder Turso creds).
vi.mock("@/server/blog-posts", () => ({
  listBlogPosts: vi.fn(async () =>
    POSTS.map((p) => ({
      slug: p.slug,
      title: p.title,
      description: p.description,
      date: p.date,
      minutes: 1,
      authorName: "TradeMarkk",
      source: "editorial" as const,
    }))
  ),
}));

import sitemap from "./sitemap";

describe("sitemap", () => {
  const entriesP = sitemap();

  it("lists the home page at priority 1", async () => {
    const entries = await entriesP;
    const home = entries.find((e) => e.url === siteConfig.url);
    expect(home).toBeDefined();
    expect(home?.priority).toBe(1);
  });

  it("includes the core public marketing routes", async () => {
    const urls = (await entriesP).map((e) => e.url);
    for (const path of [
      "/features",
      "/community",
      "/community/trending",
      "/backtesting",
      "/backtesting/explore",
      "/pulse",
      "/privacy",
      "/terms",
    ]) {
      expect(urls).toContain(`${siteConfig.url}${path}`);
    }
  });

  it("includes one entry per blog post", async () => {
    const urls = (await entriesP).map((e) => e.url);
    for (const p of POSTS) {
      expect(urls).toContain(`${siteConfig.url}/blog/${p.slug}`);
    }
  });

  it("never leaks a private /app or /api route", async () => {
    const urls = (await entriesP).map((e) => e.url);
    for (const url of urls) {
      expect(url).not.toMatch(/\/(app|api)(\/|$)/);
    }
  });

  it("produces absolute, de-duplicated, well-formed urls", async () => {
    const urls = (await entriesP).map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      expect(() => new URL(url)).not.toThrow();
      expect(url.startsWith(siteConfig.url)).toBe(true);
    }
  });
});
