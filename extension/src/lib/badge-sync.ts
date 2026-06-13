/**
 * Rules-nudge toolbar badge.
 *
 * The badge counts the daily rules the trader has NOT yet ticked once the day
 * has at least one trade — a gentle, glanceable nudge to keep rule discipline
 * honest while a session is live. It is deliberately quiet: no count before the
 * first trade, none when every rule is addressed, none when signed out or in a
 * mode the extension can't read.
 *
 * Two halves, split so the service worker can stay dependency-free:
 *  - `decideBadge` + `istDayKey` are PURE (no chrome/db) and unit-tested. The
 *    panel uses them to compute the badge from a live DbClient; the service
 *    worker re-derives the SAME decision from the cached snapshot on its alarm.
 *  - `computeBadgeData` runs the two cheap journal queries against a DbClient.
 *    Only the panel (which already holds a connection) calls it — the SW never
 *    touches the DB, it just re-applies the panel's cached snapshot and clears
 *    it when the IST day has rolled over.
 *
 * The storage key + the IST-day helper are mirrored verbatim in sw.ts (which is
 * bundled as a single dependency-free sw.js with no shared chunks) — keep them
 * in sync, exactly like the capture literals in lib/capture.ts.
 */
import type { DbClient } from "@/lib/db/types";

/** chrome.storage.session key holding the latest badge snapshot for the SW. */
export const BADGE_STATE_KEY = "badgeState";
/** Loss/amber tint for the nudge count (the app's --loss red). */
export const BADGE_COLOR = "#dc2626";
/** Runtime message the panel sends the SW after a trade-save / rule check-off. */
export const BADGE_REFRESH_MESSAGE = "tm:badge";

/** Storage modes the badge can read. Local mode lives in the web app's
 * IndexedDB (unreachable from an extension) so it never shows a count. */
export type BadgeMode = "hosted" | "byod" | "local" | null;

/** The counts the badge decision needs. */
export interface BadgeData {
  /** Trades whose IST open or close day is the snapshot day. */
  tradesToday: number;
  /** Active daily rules with no tri-state check recorded for the day. */
  untickedRules: number;
}

/** What the panel caches for the SW: the data + the context it was valid for. */
export interface BadgeSnapshot extends BadgeData {
  signedIn: boolean;
  mode: BadgeMode;
  /** IST day (YYYY-MM-DD) the counts were computed for — drives day rollover. */
  day: string;
}

export interface BadgeDecision {
  /** Toolbar text — "" clears the badge. */
  text: string;
  /** Background colour, only meaningful when `text` is non-empty. */
  color: string;
}

const CLEARED: BadgeDecision = { text: "", color: BADGE_COLOR };

/**
 * IST calendar day (YYYY-MM-DD). India keeps a fixed UTC+05:30 offset with no
 * DST, so the day boundary is a pure clock shift — independent of the host
 * machine's timezone, which keeps the badge anchored to the same market day the
 * journal's trades and rule-checks are keyed on.
 */
export function istDayKey(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

/**
 * The single source of truth for what the badge shows. Pure, so both the panel
 * and the SW (from its cached snapshot) reach the identical conclusion.
 *
 * Shows the unticked-rule count ONLY when, for the CURRENT IST day, the trader
 * is signed in, on a readable mode, has logged ≥1 trade, and still has ≥1
 * unticked rule. Anything else — no trades yet, all rules addressed, signed
 * out, local/unsupported mode, or a snapshot from an earlier day (rollover) —
 * clears the badge.
 */
export function decideBadge(
  snapshot: BadgeSnapshot,
  currentDay: string = istDayKey()
): BadgeDecision {
  if (!snapshot.signedIn) return CLEARED;
  if (snapshot.mode !== "hosted" && snapshot.mode !== "byod") return CLEARED;
  // A snapshot computed for a previous IST day is stale — a fresh day starts
  // with no trades, so the nudge clears until the panel recomputes.
  if (snapshot.day !== currentDay) return CLEARED;
  if (snapshot.tradesToday < 1) return CLEARED;
  if (snapshot.untickedRules < 1) return CLEARED;
  return { text: String(snapshot.untickedRules), color: BADGE_COLOR };
}

/**
 * The two cheap journal queries behind the badge, for the given IST day:
 *  - trades opened OR closed on that day (a still-open intraday trade counts —
 *    the rules nudge is about having traded today, not having closed);
 *  - active rules with NO rule_checks row for the day (any tri-state —
 *    followed / broken / n.a. — counts as "addressed", so only genuinely
 *    untouched rules nudge).
 * Reuses the same tables and date-prefix idiom as useGlance / useRules; two
 * small COUNT(*)s, so the 60s alarm never re-runs them (the SW re-applies the
 * cached snapshot instead).
 */
export async function computeBadgeData(db: DbClient, day: string): Promise<BadgeData> {
  const [tradesRes, rulesRes] = await Promise.all([
    db.execute(
      `SELECT COUNT(*) AS c FROM trades
       WHERE substr(opened_at, 1, 10) = ? OR substr(closed_at, 1, 10) = ?`,
      [day, day]
    ),
    db.execute(
      `SELECT COUNT(*) AS c FROM rules r
       WHERE r.active = 1
         AND NOT EXISTS (
           SELECT 1 FROM rule_checks c WHERE c.rule_id = r.id AND c.date = ?
         )`,
      [day]
    ),
  ]);
  return {
    tradesToday: Number(tradesRes.rows[0]?.c ?? 0),
    untickedRules: Number(rulesRes.rows[0]?.c ?? 0),
  };
}

/** Strict shape check — the snapshot is read back from storage in the SW. */
export function isBadgeSnapshot(v: unknown): v is BadgeSnapshot {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.tradesToday === "number" &&
    Number.isFinite(s.tradesToday) &&
    typeof s.untickedRules === "number" &&
    Number.isFinite(s.untickedRules) &&
    typeof s.signedIn === "boolean" &&
    (s.mode === "hosted" || s.mode === "byod" || s.mode === "local" || s.mode === null) &&
    typeof s.day === "string"
  );
}

/** The snapshot the panel pushes when nothing readable is connected. */
export function clearedSnapshot(mode: BadgeMode = null, day: string = istDayKey()): BadgeSnapshot {
  return { tradesToday: 0, untickedRules: 0, signedIn: false, mode, day };
}

/**
 * Panel → SW hand-off. Persists the snapshot in chrome.storage.session (so the
 * SW's alarm and any later SW restart re-derive the same badge) and pokes the
 * SW to apply it immediately. Best-effort — a missing SW or storage just means
 * the badge updates on the next alarm tick from the persisted snapshot.
 */
export async function pushBadgeSnapshot(snapshot: BadgeSnapshot): Promise<void> {
  try {
    await chrome.storage.session.set({ [BADGE_STATE_KEY]: snapshot });
  } catch {
    /* session storage unavailable — the SW alarm still re-applies last state */
  }
  try {
    await chrome.runtime.sendMessage({ type: BADGE_REFRESH_MESSAGE });
  } catch {
    /* no SW listener right now — alarm/storage cover it */
  }
}

/** Pushes a cleared snapshot (sign-out / unsupported mode). */
export async function clearBadge(mode: BadgeMode = null): Promise<void> {
  await pushBadgeSnapshot(clearedSnapshot(mode));
}
