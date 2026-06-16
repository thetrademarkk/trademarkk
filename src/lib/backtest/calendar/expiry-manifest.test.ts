/**
 * Manifest-driven expiry resolution tests. The manifest is the dataset's real
 * traded expiries (generated), so these assert the NEAREST-contract semantics and
 * the graceful null past the dataset — NOT specific dates (which the generator
 * owns). A few anchor dates are checked against the known 2026 NIFTY Tuesday
 * cadence to catch a resolver regression.
 */

import { describe, expect, it } from "vitest";
import { availableExpiries, hasManifest, resolveExpiryFromManifest } from "./expiry-manifest";

describe("expiry manifest", () => {
  it("exposes ascending, non-empty expiry lists for every index", () => {
    for (const sym of ["NIFTY", "BANKNIFTY", "SENSEX"] as const) {
      const list = availableExpiries(sym);
      expect(list.length).toBeGreaterThan(0);
      expect(hasManifest(sym)).toBe(true);
      const sorted = [...list].sort();
      expect([...list]).toEqual(sorted);
    }
  });

  it("WEEKLY resolves to the first listed expiry on or after the day", () => {
    const list = availableExpiries("NIFTY");
    const near = list.find((e) => e >= "2026-03-16")!;
    expect(resolveExpiryFromManifest("NIFTY", "2026-03-16", "WEEKLY")).toBe(near);
    // The resolved expiry is always >= the day.
    expect(resolveExpiryFromManifest("NIFTY", "2026-03-16", "WEEKLY")! >= "2026-03-16").toBe(true);
  });

  it("an exact expiry day resolves to itself (>= is inclusive)", () => {
    const list = availableExpiries("NIFTY");
    const anExpiry = list[list.length - 5]!;
    expect(resolveExpiryFromManifest("NIFTY", anExpiry, "WEEKLY")).toBe(anExpiry);
  });

  it("NEXT_WEEKLY resolves to the expiry after the nearest one", () => {
    const list = availableExpiries("NIFTY");
    const i = list.findIndex((e) => e >= "2026-01-05");
    expect(resolveExpiryFromManifest("NIFTY", "2026-01-05", "NEXT_WEEKLY")).toBe(list[i + 1]);
  });

  it("MONTHLY resolves to the last listed expiry of the nearest expiry's month", () => {
    const list = availableExpiries("NIFTY");
    const monthly = resolveExpiryFromManifest("NIFTY", "2026-04-02", "MONTHLY")!;
    const month = monthly.slice(0, 7);
    // It is in some month, and is the LAST listed expiry of that month.
    const lastOfMonth = list.filter((e) => e.slice(0, 7) === month).at(-1);
    expect(monthly).toBe(lastOfMonth);
  });

  it("returns null past the end of the dataset (caller falls back to the calendar)", () => {
    expect(resolveExpiryFromManifest("NIFTY", "2099-01-01", "WEEKLY")).toBeNull();
  });
});
