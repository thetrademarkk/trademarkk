import type { NotificationView } from "./types";

/**
 * Per-user, per-TYPE notification preferences for the in-app stream.
 *
 * ── Storage model (compact + forward-compatible) ──────────────────────────────
 * Persisted as a tiny JSON object on `profiles.notification_prefs` that records
 * ONLY the types a user has switched OFF, e.g. `{"follow":false,"like":false}`.
 *
 *   • Default = every type ON. A NULL/absent column, an empty object, or a type
 *     not present in the map all mean "enabled". This is the crucial backward-
 *     compatible default: existing users (no row/column) keep getting every
 *     notification, and any NEW type added later (e.g. a parallel backtest lane's
 *     `backtest_done`/`backtest_failed`) is ON until the user explicitly opts out.
 *   • Because absence = ON, a missing/unknown type can NEVER silently drop a
 *     notification — we only suppress a type the user has DELIBERATELY disabled.
 *
 * ── Bypass-exempt types ───────────────────────────────────────────────────────
 * Some notifications are operationally critical and must reach the user
 * regardless of preferences — moderation/admin actions and account-security
 * events. These are listed in {@link BYPASS_PREF_TYPES} and ALWAYS deliver.
 */

/**
 * The notification types a user may toggle in the preferences UI, each with the
 * label + one-line description shown in the settings panel. This drives BOTH the
 * UI rows and the "is this a known, user-controllable type" check. Order here is
 * the display order. Keep additive — appending a type is safe; the default for
 * anything not listed is still ON (so a new emit type is never dropped).
 */
export const NOTIFICATION_PREF_TYPES = [
  {
    type: "reply",
    label: "Replies",
    description: "When someone replies to your comment.",
  },
  {
    type: "comment",
    label: "Comments",
    description: "When someone comments on your post.",
  },
  {
    type: "like",
    label: "Reactions",
    description: "When someone reacts to your post or comment.",
  },
  {
    type: "reshare",
    label: "Reshares",
    description: "When someone reshares or quotes your post.",
  },
  {
    type: "mention",
    label: "Mentions",
    description: "When someone @mentions you in a post or comment.",
  },
  {
    type: "message",
    label: "Direct messages",
    description: "When someone sends you a direct message.",
  },
  {
    type: "follow",
    label: "New followers",
    description: "When someone starts following you.",
  },
] as const;

/** A notification type the user can toggle in preferences. */
export type PrefNotificationType = (typeof NOTIFICATION_PREF_TYPES)[number]["type"];

/** Fast membership set of the toggleable types. */
const KNOWN_PREF_TYPES = new Set<string>(NOTIFICATION_PREF_TYPES.map((t) => t.type));

/**
 * Types that ALWAYS deliver, even if a user tried to disable them — moderation /
 * admin actions and account-security events. Preferences must never suppress
 * these. (None of the current community emit types are in here yet; this is the
 * guard rail for when such notifications are added.)
 */
export const BYPASS_PREF_TYPES = new Set<string>([
  "moderation",
  "mod_action",
  "admin",
  "security",
  "account",
]);

/** The compact on-disk shape: a sparse map of disabled types. */
export type NotificationPrefs = Record<string, boolean>;

/**
 * Parses the stored JSON (or null) into a sparse prefs map. Tolerant: bad JSON,
 * non-objects, and non-boolean values are dropped so a corrupt column degrades
 * to "all defaults" rather than throwing or silently disabling everything.
 */
export function parseNotificationPrefs(raw: string | null | undefined): NotificationPrefs {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: NotificationPrefs = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "boolean") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Serializes a prefs map back to the compact JSON we persist — keeping ONLY the
 * `false` (disabled) entries, sorted for a stable byte representation. Returns
 * `null` when nothing is disabled so an "all-on" user stores no column at all.
 */
export function serializeNotificationPrefs(prefs: NotificationPrefs): string | null {
  const disabled: NotificationPrefs = {};
  for (const key of Object.keys(prefs).sort()) {
    if (prefs[key] === false) disabled[key] = false;
  }
  return Object.keys(disabled).length ? JSON.stringify(disabled) : null;
}

/**
 * THE enforcement predicate, consulted by the server's `notify()` at emit time.
 *
 * Returns whether a notification of `type` should be delivered to a recipient
 * with the given prefs. Critical/bypass types ALWAYS return true. Otherwise the
 * default is ON: only an explicit `false` for that exact type suppresses it, so
 * an unknown/new type (absent from the map) is always allowed through.
 */
export function isNotificationAllowed(prefs: NotificationPrefs, type: string): boolean {
  if (BYPASS_PREF_TYPES.has(type)) return true;
  return prefs[type] !== false;
}

/**
 * Builds the FULL toggle state for the settings UI: every toggleable type mapped
 * to its current on/off value (default ON). The UI renders one Switch per entry.
 */
export function resolvePrefToggles(
  prefs: NotificationPrefs
): Array<{ type: PrefNotificationType; label: string; description: string; enabled: boolean }> {
  return NOTIFICATION_PREF_TYPES.map((t) => ({
    type: t.type,
    label: t.label,
    description: t.description,
    enabled: isNotificationAllowed(prefs, t.type),
  }));
}

/**
 * Applies a single toggle to a prefs map, returning a NEW map (immutable). When
 * a type is turned back ON we DELETE its entry rather than store `true`, keeping
 * the persisted object minimal (only disabled types are ever stored).
 */
export function applyPrefToggle(
  prefs: NotificationPrefs,
  type: string,
  enabled: boolean
): NotificationPrefs {
  const next = { ...prefs };
  if (enabled) delete next[type];
  else next[type] = false;
  return next;
}

/** Narrows an arbitrary string to a known, user-controllable preference type. */
export function isPrefNotificationType(type: string): type is PrefNotificationType {
  return KNOWN_PREF_TYPES.has(type);
}

/** Compile-time guard: every NotificationView type has a UI row (or is bypassed). */
export type _AllViewTypesCovered = NotificationView["type"] extends PrefNotificationType
  ? true
  : never;
