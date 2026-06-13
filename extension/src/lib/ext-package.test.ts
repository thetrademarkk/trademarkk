import { describe, it, expect } from "vitest";
// The Web Store packager's manifest validator is pure — unit-test it here so a
// bad manifest fails the build before it ever reaches the zip step.
// @ts-expect-error — the packager is a plain .mjs with a JSDoc-typed export.
import { validateManifest } from "../../../scripts/ext-package.mjs";

/** A minimal manifest that passes every rule — clone + mutate per case. */
function validManifest(): Record<string, unknown> {
  return {
    manifest_version: 3,
    name: "TradeMarkk — Trading Journal Companion",
    version: "1.1.0",
    description: "Log trades and tick your rules without leaving your broker's page.",
    icons: { "16": "icons/icon16.png", "128": "icons/icon128.png" },
    background: { service_worker: "sw.js", type: "module" },
  };
}

describe("validateManifest", () => {
  it("accepts the real extension manifest shape", () => {
    expect(validateManifest(validManifest())).toEqual([]);
  });

  it("rejects a non-object", () => {
    expect(validateManifest(null).length).toBeGreaterThan(0);
    expect(validateManifest("nope" as unknown).length).toBeGreaterThan(0);
  });

  it("requires manifest_version 3", () => {
    const m = { ...validManifest(), manifest_version: 2 };
    expect(validateManifest(m).some((p: string) => p.includes("manifest_version"))).toBe(true);
  });

  it("requires a name containing the TradeMarkk brand", () => {
    const missing = { ...validManifest(), name: "" };
    expect(validateManifest(missing).some((p: string) => p.includes("name"))).toBe(true);
    const wrongBrand = { ...validManifest(), name: "Some Other Journal" };
    expect(validateManifest(wrongBrand).some((p: string) => p.includes("TradeMarkk"))).toBe(true);
  });

  it("rejects an over-long name (> 75 chars)", () => {
    const m = { ...validManifest(), name: "TradeMarkk " + "x".repeat(80) };
    expect(validateManifest(m).some((p: string) => p.includes("≤ 75"))).toBe(true);
  });

  it("validates the version format", () => {
    expect(validateManifest({ ...validManifest(), version: "" }).length).toBeGreaterThan(0);
    expect(
      validateManifest({ ...validManifest(), version: "1.2.3.4.5" }).some((p: string) =>
        p.includes("version")
      )
    ).toBe(true);
    expect(
      validateManifest({ ...validManifest(), version: "1.beta" }).some((p: string) =>
        p.includes("version")
      )
    ).toBe(true);
    expect(
      validateManifest({ ...validManifest(), version: "1.70000" }).some((p: string) =>
        p.includes("65535")
      )
    ).toBe(true);
    // Valid alternative forms.
    expect(validateManifest({ ...validManifest(), version: "2" })).toEqual([]);
    expect(validateManifest({ ...validManifest(), version: "1.0.0.0" })).toEqual([]);
  });

  it("requires a description within the 132-char store cap", () => {
    expect(
      validateManifest({ ...validManifest(), description: "" }).some((p: string) =>
        p.includes("description")
      )
    ).toBe(true);
    const tooLong = { ...validManifest(), description: "x".repeat(133) };
    expect(validateManifest(tooLong).some((p: string) => p.includes("132"))).toBe(true);
  });

  it("requires a 128px icon", () => {
    const noIcons = { ...validManifest() };
    delete noIcons.icons;
    expect(validateManifest(noIcons).some((p: string) => p.includes("icon"))).toBe(true);
    const no128 = { ...validManifest(), icons: { "16": "icons/icon16.png" } };
    expect(validateManifest(no128).some((p: string) => p.includes("128"))).toBe(true);
  });

  it("requires an MV3 background service worker", () => {
    const noBg = { ...validManifest() };
    delete noBg.background;
    expect(validateManifest(noBg).some((p: string) => p.includes("service_worker"))).toBe(true);
    const badBg = { ...validManifest(), background: { page: "bg.html" } };
    expect(validateManifest(badBg).some((p: string) => p.includes("service_worker"))).toBe(true);
  });

  it("accumulates multiple problems at once", () => {
    const broken = { manifest_version: 2, name: "x", version: "", description: "" };
    expect(validateManifest(broken).length).toBeGreaterThanOrEqual(3);
  });
});
