import { describe, expect, it } from "vitest";
import { runByoc } from "./sandbox";
import type { ByocBar } from "./types";

// A simple synthetic series (rises, dips, rises) for deterministic assertions.
const BARS: ByocBar[] = Array.from({ length: 30 }, (_, i) => {
  const c = 100 + Math.sin(i / 3) * 5 + i * 0.2;
  return {
    t: `2026-01-01 ${String(9 + Math.floor(i / 60)).padStart(2, "0")}:${String(15 + (i % 60)).padStart(2, "0")}:00`,
    o: c,
    h: c + 1,
    l: c - 1,
    c,
    v: 100 + i,
  };
});

describe("runByoc — sandboxed user strategy", () => {
  it("runs a valid SMA-crossover strategy and scores trades", async () => {
    const code = `
      function strategy(bars, ta) {
        const c = ta.closes(bars);
        const fast = ta.sma(c, 3), slow = ta.sma(c, 8);
        const trades = [];
        let inPos = -1;
        for (let i = 0; i < bars.length; i++) {
          if (inPos < 0 && ta.crossover(fast, slow, i)) inPos = i;
          else if (inPos >= 0 && ta.crossunder(fast, slow, i)) { trades.push({ entryIndex: inPos, exitIndex: i, side: "long" }); inPos = -1; }
        }
        return trades;
      }
    `;
    const r = await runByoc(code, BARS, { timeoutMs: 4000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(typeof r.stats.totalReturn).toBe("number");
      expect(Number.isNaN(r.stats.totalReturn)).toBe(false);
      for (const t of r.scored) {
        expect(t.exitIndex).toBeGreaterThan(t.entryIndex);
      }
    }
  });

  it("captures console.log output", async () => {
    const r = await runByoc(`function strategy(bars){ console.log("hi", 42); return []; }`, BARS);
    expect(r.ok).toBe(true);
    expect(r.logs.join(" ")).toContain("hi 42");
  });

  it("has NO host access — fetch / window / process are undefined in the VM", async () => {
    const code = `function strategy(){ return [{ entryIndex: 0, exitIndex: 1, side: typeof fetch === "undefined" && typeof window === "undefined" && typeof process === "undefined" ? "long" : "short" }]; }`;
    const r = await runByoc(code, BARS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scored[0]!.side).toBe("long"); // proves all three are undefined
  });

  it("interrupts an infinite loop at the timeout (no hang)", async () => {
    const r = await runByoc(`function strategy(){ while(true){} }`, BARS, { timeoutMs: 300 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.phase).toBe("timeout");
  });

  it("reports a runtime error honestly (no result fabricated)", async () => {
    const r = await runByoc(`function strategy(){ throw new Error("boom"); }`, BARS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.phase).toBe("run");
      expect(r.error).toContain("boom");
    }
  });

  it("requires a strategy function", async () => {
    const r = await runByoc(`const x = 1;`, BARS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain("strategy");
  });

  it("rejects a non-array return with an honest shape error", async () => {
    const r = await runByoc(`function strategy(){ return 42; }`, BARS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.phase).toBe("shape");
  });

  it("rejects an out-of-range trade index", async () => {
    const r = await runByoc(
      `function strategy(){ return [{entryIndex:0,exitIndex:9999,side:"long"}]; }`,
      BARS
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.phase).toBe("shape");
  });
});
