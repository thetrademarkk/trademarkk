import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Second build pass: broker content scripts. Chrome injects content scripts
 * as CLASSIC scripts (no ES modules), so each bundles standalone as an IIFE —
 * and rollup forbids code-splitting with iife output, hence exactly one entry
 * here (a future Upstox/Groww script becomes another pass or its own config).
 * emptyOutDir stays false: the main pass already produced extension/dist.
 */
export default defineConfig({
  root: dir,
  publicDir: false,
  resolve: {
    alias: { "@": path.resolve(dir, "../src") },
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(dir, "src/content/kite-capture.ts"),
      output: { format: "iife", entryFileNames: "content-kite.js" },
    },
  },
});
