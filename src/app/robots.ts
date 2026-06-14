import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /app + /api are private; the rest are sign-in-gated personal surfaces
        // or token-gated transactional pages (also meta-noindexed) — disallowing
        // them only saves crawl budget.
        disallow: [
          "/app",
          "/api",
          "/community/messages",
          "/community/notifications",
          "/reset-password",
        ],
      },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
  };
}
