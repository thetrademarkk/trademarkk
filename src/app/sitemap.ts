import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";
import { POSTS } from "@/content/posts";

// Only the public marketing surface is in the sitemap — /app/* is private.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteConfig.url;
  const staticPages = ["", "/features", "/docs", "/faq", "/blog", "/changelog", "/compare/tradezella-alternative"];
  return [
    ...staticPages.map((path) => ({
      url: `${base}${path}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: path === "" ? 1 : 0.7,
    })),
    ...POSTS.map((p) => ({
      url: `${base}/blog/${p.slug}`,
      lastModified: new Date(p.date),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
