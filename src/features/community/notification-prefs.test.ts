import { describe, expect, it } from "vitest";
import {
  applyPrefToggle,
  BYPASS_PREF_TYPES,
  isNotificationAllowed,
  isPrefNotificationType,
  NOTIFICATION_PREF_TYPES,
  parseNotificationPrefs,
  resolvePrefToggles,
  serializeNotificationPrefs,
} from "./notification-prefs";

describe("isNotificationAllowed — the emit-time enforcement predicate", () => {
  it("defaults ON when there is no pref at all (existing users unaffected)", () => {
    expect(isNotificationAllowed({}, "follow")).toBe(true);
    expect(isNotificationAllowed({}, "like")).toBe(true);
    expect(isNotificationAllowed({}, "comment")).toBe(true);
  });

  it("suppresses ONLY a type explicitly set to false", () => {
    const prefs = { follow: false };
    expect(isNotificationAllowed(prefs, "follow")).toBe(false);
    // every other type still flows
    expect(isNotificationAllowed(prefs, "like")).toBe(true);
    expect(isNotificationAllowed(prefs, "comment")).toBe(true);
    expect(isNotificationAllowed(prefs, "reply")).toBe(true);
  });

  it("treats an UNKNOWN/new type as ON (a missing pref can never drop it silently)", () => {
    // e.g. a parallel backtest lane adding these to the union later.
    expect(isNotificationAllowed({}, "backtest_done")).toBe(true);
    expect(isNotificationAllowed({}, "backtest_failed")).toBe(true);
    expect(isNotificationAllowed({ follow: false }, "backtest_done")).toBe(true);
  });

  it("lets an unknown type be opted out only if explicitly disabled", () => {
    expect(isNotificationAllowed({ backtest_failed: false }, "backtest_failed")).toBe(false);
    expect(isNotificationAllowed({ backtest_failed: false }, "backtest_done")).toBe(true);
  });

  it("ALWAYS delivers bypass-exempt (moderation/security) types, even if disabled", () => {
    for (const t of BYPASS_PREF_TYPES) {
      expect(isNotificationAllowed({}, t)).toBe(true);
      // Even a (nonsensical) attempt to disable a bypass type cannot suppress it.
      expect(isNotificationAllowed({ [t]: false }, t)).toBe(true);
    }
  });
});

describe("parseNotificationPrefs — tolerant (de)serialization", () => {
  it("returns {} for null/empty/garbage rather than throwing or disabling all", () => {
    expect(parseNotificationPrefs(null)).toEqual({});
    expect(parseNotificationPrefs(undefined)).toEqual({});
    expect(parseNotificationPrefs("")).toEqual({});
    expect(parseNotificationPrefs("not json")).toEqual({});
    expect(parseNotificationPrefs("[1,2,3]")).toEqual({}); // arrays are not maps
    expect(parseNotificationPrefs("42")).toEqual({});
  });

  it("keeps only boolean entries (drops corrupt non-boolean values)", () => {
    expect(parseNotificationPrefs('{"follow":false,"like":"nope","comment":true}')).toEqual({
      follow: false,
      comment: true,
    });
  });

  it("round-trips a disabled set", () => {
    const json = serializeNotificationPrefs({ follow: false, like: false });
    expect(json).not.toBeNull();
    expect(parseNotificationPrefs(json)).toEqual({ follow: false, like: false });
  });
});

describe("serializeNotificationPrefs — compact, only-disabled, stable", () => {
  it("returns null when nothing is disabled (all-on stores no column)", () => {
    expect(serializeNotificationPrefs({})).toBeNull();
    expect(serializeNotificationPrefs({ follow: true, like: true })).toBeNull();
  });

  it("stores ONLY the disabled types", () => {
    expect(serializeNotificationPrefs({ follow: false, like: true, comment: false })).toBe(
      '{"comment":false,"follow":false}'
    );
  });

  it("is byte-stable regardless of key insertion order (sorted)", () => {
    expect(serializeNotificationPrefs({ like: false, follow: false })).toBe(
      serializeNotificationPrefs({ follow: false, like: false })
    );
  });
});

describe("applyPrefToggle — immutable single toggle", () => {
  it("disables a type by storing false", () => {
    expect(applyPrefToggle({}, "follow", false)).toEqual({ follow: false });
  });

  it("re-enabling DELETES the entry (keeps the stored map minimal)", () => {
    expect(applyPrefToggle({ follow: false }, "follow", true)).toEqual({});
  });

  it("does not mutate the input", () => {
    const input = { follow: false };
    const out = applyPrefToggle(input, "like", false);
    expect(input).toEqual({ follow: false });
    expect(out).toEqual({ follow: false, like: false });
  });
});

describe("resolvePrefToggles — the UI toggle list", () => {
  it("returns one row per toggleable type, all ON by default", () => {
    const toggles = resolvePrefToggles({});
    expect(toggles).toHaveLength(NOTIFICATION_PREF_TYPES.length);
    expect(toggles.every((t) => t.enabled)).toBe(true);
    expect(toggles.every((t) => t.label && t.description)).toBe(true);
  });

  it("reflects a disabled type as off, others on", () => {
    const toggles = resolvePrefToggles({ follow: false });
    expect(toggles.find((t) => t.type === "follow")!.enabled).toBe(false);
    expect(toggles.filter((t) => t.type !== "follow").every((t) => t.enabled)).toBe(true);
  });
});

describe("isPrefNotificationType — guards the writable type set", () => {
  it("accepts known toggleable types", () => {
    for (const t of NOTIFICATION_PREF_TYPES) expect(isPrefNotificationType(t.type)).toBe(true);
  });
  it("rejects unknown/bypass types (not user-writable here)", () => {
    expect(isPrefNotificationType("backtest_done")).toBe(false);
    expect(isPrefNotificationType("moderation")).toBe(false);
    expect(isPrefNotificationType("")).toBe(false);
  });
});
