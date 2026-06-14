import type { NextConfig } from "next";

/**
 * Content-Security-Policy notes (each directive is load-bearing):
 * - script-src 'unsafe-inline': Next.js hydration + the no-flash theme script
 *   are inline without nonces; 'wasm-unsafe-eval' lets sql.js compile its WASM
 *   (demo/local mode). No third-party script hosts are allowed at all.
 * - connect-src https: wss:: hosted/BYOD journals talk to the user's own
 *   libsql/Turso database directly from the browser — the hostname is
 *   user-supplied, so it cannot be allowlisted statically. http: is blocked.
 * - img-src data: blob:: avatars and post images are compressed data-URLs.
 * - frame-ancestors 'none' mirrors X-Frame-Options: DENY.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Tree-shake barrel imports from heavy UI/chart/animation libs so a single
  // `import { X } from "pkg"` doesn't drag the whole package into a chunk. The
  // landing hero pulls motion + @number-flow/react, and recharts is used across
  // the analytics/backtesting views. This is a build-time transform with a
  // graceful fallback (Next no-ops it for packages it can't optimize).
  experimental: {
    optimizePackageImports: ["motion", "recharts", "@number-flow/react", "lucide-react"],
  },
  // Link-unfurl preview images are remote https URLs (extracted from a page's
  // og:image). They render through next/image, so the BROWSER only ever loads
  // `/_next/image?url=…` (same-origin — satisfies the strict img-src CSP). The
  // image URLs we ever pass are https-only by construction (see unfurl.ts).
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
    // Cap the optimizer's work; previews are small cards, never hero images.
    deviceSizes: [640, 750, 828, 1080],
  },
  // Test/CI builds set NEXT_DIST_DIR (e.g. ".next-e2e") so they never clobber
  // the dev server's .next cache — building while `next dev` runs corrupts it.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Pin the workspace root to THIS checkout. Without it, Next walks up,
  // finds another lockfile (e.g. the main checkout above a git worktree) and
  // mixes two React copies — the /_error prerender then dies on useContext.
  outputFileTracingRoot: __dirname,
  // The dead in-app backtesting placeholder is gone; its promise now resolves to
  // the real public /backtesting universe. Permanent (308) so search engines and
  // bookmarks update. Legacy /app/app/backtesting kept for old deep links.
  redirects: async () => [
    { source: "/app/backtesting", destination: "/backtesting", permanent: true },
    { source: "/app/app/backtesting", destination: "/backtesting", permanent: true },
  ],
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=()",
        },
      ],
    },
    {
      // The hand-rolled service worker must always revalidate.
      source: "/sw.js",
      headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
    },
  ],
};

export default nextConfig;
