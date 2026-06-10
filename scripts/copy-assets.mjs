// Copies the sql.js wasm binaries into /public so the in-browser demo mode can load them.
// Webpack may resolve sql.js to either the node or browser build, which request
// different wasm filenames — ship both.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(root, "node_modules", "sql.js", "dist");
const destDir = join(root, "public", "sqljs");

const files = ["sql-wasm.wasm", "sql-wasm-browser.wasm"];
mkdirSync(destDir, { recursive: true });
for (const file of files) {
  const src = join(distDir, file);
  if (existsSync(src)) {
    copyFileSync(src, join(destDir, file));
    console.log(`[copy-assets] ${file} -> public/sqljs/`);
  } else {
    console.log(`[copy-assets] ${file} not found, skipping`);
  }
}
