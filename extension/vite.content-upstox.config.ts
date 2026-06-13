import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Fourth build pass: the Upstox order-window capture content script. Chrome
 * injects content scripts as CLASSIC scripts (no ES modules), and rollup
 * forbids code-splitting with iife output, so each content entry is its own
 * pass producing a standalone IIFE. emptyOutDir stays false: the main pass
 * already produced extension/dist.
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
      input: path.resolve(dir, "src/content/upstox-capture.ts"),
      output: { format: "iife", entryFileNames: "content-upstox.js" },
    },
  },
});
