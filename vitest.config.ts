import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Transform JSX with React 19's automatic runtime (matching Next) so server-
  // safe components like RichContent can be unit-tested via renderToStaticMarkup
  // without importing React in every source file. No effect on .ts-only tests.
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "extension/src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` throws unless resolved via Next's `react-server`
      // condition; map it to its no-op build so server modules can be
      // unit-tested under the node environment.
      "server-only": path.resolve(__dirname, "./node_modules/server-only/empty.js"),
    },
  },
});
