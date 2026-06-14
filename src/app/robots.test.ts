import { describe, expect, it } from "vitest";
import robots from "./robots";
import { siteConfig } from "@/config/site";

describe("robots", () => {
  const out = robots();
  const rule = Array.isArray(out.rules) ? out.rules[0] : out.rules;

  it("allows all crawlers at the root", () => {
    expect(rule?.userAgent).toBe("*");
    expect(rule?.allow).toBe("/");
  });

  it("disallows the private app and api surfaces", () => {
    const disallow = ([] as string[]).concat(rule?.disallow ?? []);
    expect(disallow).toContain("/app");
    expect(disallow).toContain("/api");
  });

  it("references the absolute sitemap url", () => {
    expect(out.sitemap).toBe(`${siteConfig.url}/sitemap.xml`);
    expect(() => new URL(String(out.sitemap))).not.toThrow();
  });
});
