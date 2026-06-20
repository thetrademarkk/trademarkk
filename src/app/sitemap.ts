import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";
import { listBlogPosts } from "@/server/blog-posts";

// Only the public marketing surface is in the sitemap — /app/* is private.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteConfig.url;
  const staticPages = [
    "",
    "/features",
    "/community",
    "/community/trending",
    "/backtesting",
    "/backtesting/explore",
    "/expiry-calendar",
    "/pulse",
    "/docs",
    "/faq",
    "/blog",
    "/changelog",
    "/compare/tradezella-alternative",
    "/privacy",
    "/terms",
  ];
  // Editorial + APPROVED community blog posts (degrades to editorial-only on a
  // DB failure, e.g. a CI build with placeholder Turso creds).
  const blogPosts = await listBlogPosts();
  return [
    ...staticPages.map((path) => ({
      url: `${base}${path}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: path === "" ? 1 : path === "/privacy" || path === "/terms" ? 0.4 : 0.7,
    })),
    ...blogPosts.map((p) => ({
      url: `${base}/blog/${p.slug}`,
      lastModified: new Date(p.date),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
