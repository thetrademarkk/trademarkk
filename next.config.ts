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
  // Test/CI builds set NEXT_DIST_DIR (e.g. ".next-e2e") so they never clobber
  // the dev server's .next cache — building while `next dev` runs corrupts it.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Pin the workspace root to THIS checkout. Without it, Next walks up,
  // finds another lockfile (e.g. the main checkout above a git worktree) and
  // mixes two React copies — the /_error prerender then dies on useContext.
  outputFileTracingRoot: __dirname,
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
