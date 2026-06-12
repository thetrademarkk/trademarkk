import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the MV3 extension into extension/dist:
 *  - sidepanel.html / popup.html — the same React UI in both surfaces
 *  - sw.js — dependency-free service worker at the bundle root
 *  - public/ (manifest.json + icons) copied verbatim
 * `@` aliases the app's src/ so the extension reuses the exact statement
 * builders, parsers and charge math the web client uses.
 */
export default defineConfig({
  root: dir,
  publicDir: "public",
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(dir, "../src") },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: path.resolve(dir, "sidepanel.html"),
        popup: path.resolve(dir, "popup.html"),
        sw: path.resolve(dir, "src/sw.ts"),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js"),
      },
    },
  },
});
