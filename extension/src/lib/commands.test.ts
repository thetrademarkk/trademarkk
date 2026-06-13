import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OPEN_PANEL_COMMAND } from "./commands";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(path.resolve(here, "../../public/manifest.json"), "utf8")
) as {
  commands?: Record<string, { suggested_key?: Record<string, string>; description?: string }>;
};

describe("keyboard commands", () => {
  it("uses a stable, brand-consistent open-panel command name", () => {
    expect(OPEN_PANEL_COMMAND).toBe("open-trademarkk-panel");
  });

  it("manifest declares the open-panel command (keeps the SW literal in sync)", () => {
    expect(manifest.commands).toBeDefined();
    expect(manifest.commands?.[OPEN_PANEL_COMMAND]).toBeDefined();
  });

  it("binds Ctrl+Shift+J (MacCtrl on macOS, never Chrome's reserved chords)", () => {
    const keys = manifest.commands?.[OPEN_PANEL_COMMAND]?.suggested_key ?? {};
    expect(keys.default).toBe("Ctrl+Shift+J");
    expect(keys.mac).toBe("MacCtrl+Shift+J");
    // Cmd+Shift+J is Chrome's Downloads shortcut on macOS; MacCtrl avoids it.
    expect(Object.values(keys)).not.toContain("Command+Shift+J");
  });

  it("carries a TradeMarkk-branded description", () => {
    expect(manifest.commands?.[OPEN_PANEL_COMMAND]?.description).toMatch(/TradeMarkk/);
  });
});
