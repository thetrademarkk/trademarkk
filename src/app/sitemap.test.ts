import { describe, expect, it } from "vitest";
import sitemap from "./sitemap";
import { siteConfig } from "@/config/site";
import { POSTS } from "@/content/posts";

describe("sitemap", () => {
  const entries = sitemap();
  const urls = entries.map((e) => e.url);

  it("lists the home page at priority 1", () => {
    const home = entries.find((e) => e.url === siteConfig.url);
    expect(home).toBeDefined();
    expect(home?.priority).toBe(1);
  });

  it("includes the core public marketing routes", () => {
    for (const path of ["/features", "/community", "/pulse", "/privacy", "/terms"]) {
      expect(urls).toContain(`${siteConfig.url}${path}`);
    }
  });

  it("includes one entry per blog post", () => {
    for (const p of POSTS) {
      expect(urls).toContain(`${siteConfig.url}/blog/${p.slug}`);
    }
  });

  it("never leaks a private /app or /api route", () => {
    for (const url of urls) {
      expect(url).not.toMatch(/\/(app|api)(\/|$)/);
    }
  });

  it("produces absolute, de-duplicated, well-formed urls", () => {
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      expect(() => new URL(url)).not.toThrow();
      expect(url.startsWith(siteConfig.url)).toBe(true);
    }
  });
});
