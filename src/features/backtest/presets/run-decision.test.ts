import { describe, expect, it } from "vitest";
import { availabilityFrom, decidePresetRun, isPresetRunnable } from "./run-decision";
import { localDataAvailability } from "./local-availability";
import { PRESETS, presetById } from "./catalogue";

describe("decidePresetRun — run vs honest-locked", () => {
  it("LOCKED (honest, never a result) when the source has no data in the window", () => {
    const preset = presetById("banknifty-short-strangle")!;
    const empty = availabilityFrom([]);
    const d = decidePresetRun(preset, empty);
    expect(d.kind).toBe("locked");
    if (d.kind === "locked") {
      expect(d.reason.toLowerCase()).toContain("unlock");
      expect(d.reason.toLowerCase()).toContain("dataset");
      // Honest framing — never claims a result exists
      expect(d.reason.toLowerCase()).not.toContain("loss");
      expect(d.reason.toLowerCase()).not.toContain("profit");
    }
  });

  it("RUN when the source has at least one day inside the window", () => {
    const preset = presetById("nifty-short-straddle")!;
    const avail = availabilityFrom([{ symbol: "NIFTY", days: ["2024-07-25"] }]);
    const d = decidePresetRun(preset, avail);
    expect(d.kind).toBe("run");
    if (d.kind === "run") {
      expect(d.availableDays).toEqual(["2024-07-25"]);
      expect(d.partial).toBe(true); // one committed day in a multi-week window
    }
  });

  it("marks a run NON-partial only when the source spans the whole window", () => {
    // A single-expiry preset would be non-partial if its whole window is one week
    const preset = presetById("nifty-short-straddle")!;
    // Saturate the whole declared window with trading days
    const start = "2024-07-04";
    const end = "2024-09-26";
    const days: string[] = [];
    for (let t = Date.parse(start); t <= Date.parse(end); t += 86_400_000) {
      const d = new Date(t);
      const dow = d.getUTCDay();
      if (dow >= 1 && dow <= 5) days.push(d.toISOString().slice(0, 10));
    }
    const avail = availabilityFrom([{ symbol: "NIFTY", days }]);
    const d = decidePresetRun(preset, avail);
    expect(d.kind).toBe("run");
    if (d.kind === "run") expect(d.partial).toBe(false);
  });

  it("only intersects days inside the window (out-of-range days ignored)", () => {
    const preset = presetById("nifty-short-straddle")!;
    const avail = availabilityFrom([
      { symbol: "NIFTY", days: ["2020-01-01", "2024-07-25", "2030-01-01"] },
    ]);
    const d = decidePresetRun(preset, avail);
    expect(d.kind).toBe("run");
    if (d.kind === "run") expect(d.availableDays).toEqual(["2024-07-25"]);
  });

  it("a different symbol's data does not unlock a preset", () => {
    const preset = presetById("nifty-short-straddle")!; // NIFTY
    const avail = availabilityFrom([{ symbol: "SENSEX", days: ["2024-07-25"] }]);
    expect(isPresetRunnable(preset, avail)).toBe(false);
  });
});

describe("live HF availability (expiry manifest)", () => {
  it("unlocks NIFTY presets whose window is in the dataset", () => {
    const avail = localDataAvailability();
    expect(isPresetRunnable(presetById("nifty-short-straddle")!, avail)).toBe(true);
  });

  it("now unlocks BANKNIFTY / SENSEX presets too (the seam is connected)", () => {
    const avail = localDataAvailability();
    // These were locked on the golden-only slice; the live dataset spans their
    // windows, so they run with NO change to the preset definitions.
    expect(isPresetRunnable(presetById("banknifty-short-strangle")!, avail)).toBe(true);
    expect(isPresetRunnable(presetById("sensex-iron-condor")!, avail)).toBe(true);
  });

  it("every catalogue preset is runnable against the live dataset", () => {
    const avail = localDataAvailability();
    const locked = PRESETS.filter((p) => !isPresetRunnable(p, avail));
    expect(locked).toEqual([]);
  });
});

describe("BT-08 swap seam — zero preset code change", () => {
  it("a preset is LOCKED with no data and RUNS once the source reports its window — same definition", () => {
    const preset = presetById("sensex-iron-condor")!;
    // No data at all -> honest locked.
    expect(decidePresetRun(preset, availabilityFrom([])).kind).toBe("locked");
    // The source reports a day in the preset's window -> run, with NO change to
    // the preset definition itself.
    const hfLike = availabilityFrom([{ symbol: "SENSEX", days: ["2025-01-14"] }]);
    expect(decidePresetRun(preset, hfLike).kind).toBe("run");
  });
});
