/**
 * Copy the @duckdb/duckdb-wasm browser bundles (wasm + worker JS) from
 * node_modules into public/duckdb/ so the app serves them SAME-ORIGIN.
 *
 * Why: the app CSP is `worker-src 'self' blob:` (no CDN), so loading the duckdb
 * worker cross-origin from jsDelivr is blocked. Self-hosting keeps the data
 * layer CSP-clean, CDN-independent and offline-capable (the SW can cache it).
 * Runs as a `prebuild` step (and can be run manually for local dev). The output
 * dir is gitignored — it is regenerated from the pinned dep on every build,
 * including on Vercel.
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "node_modules", "@duckdb", "duckdb-wasm", "dist");
const out = join(root, "public", "duckdb");

// selectBundle() picks `eh` on modern browsers (exception-handling, single-
// threaded without cross-origin isolation) and falls back to `mvp`. Ship both.
const FILES = [
  "duckdb-mvp.wasm",
  "duckdb-browser-mvp.worker.js",
  "duckdb-eh.wasm",
  "duckdb-browser-eh.worker.js",
];

if (!existsSync(dist)) {
  console.error(`[copy-duckdb] dist not found: ${dist} — is @duckdb/duckdb-wasm installed?`);
  process.exit(1);
}
mkdirSync(out, { recursive: true });
let n = 0;
for (const f of FILES) {
  const src = join(dist, f);
  if (!existsSync(src)) {
    console.error(`[copy-duckdb] missing ${f} in dist`);
    process.exit(1);
  }
  copyFileSync(src, join(out, f));
  n++;
}
console.log(`[copy-duckdb] copied ${n} files -> public/duckdb/`);
