/**
 * MV3 service worker — intentionally dependency-free (it must build as a
 * single root-level sw.js with no shared chunks).
 *
 * Surface selection is resolved at runtime because Chrome's docs leave the
 * default_popup vs openPanelOnActionClick precedence undefined:
 *  - sidePanel API available (Chrome 114+): toolbar click opens the side panel.
 *  - otherwise (older Chromium forks): the same UI is wired as an action popup.
 */
function wireActionSurface(): void {
  if (chrome.sidePanel?.setPanelBehavior) {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    void chrome.action.setPopup({ popup: "" });
  } else {
    void chrome.action.setPopup({ popup: "popup.html" });
  }
}

chrome.runtime.onInstalled.addListener(wireActionSurface);
chrome.runtime.onStartup.addListener(wireActionSurface);
wireActionSurface();

/**
 * Broker capture: a content script (extension/src/content/) read the visible
 * order-entry fields and wants them in the quick log. Stage the capture in
 * storage.session — the panel consumes it whether it is already open (storage
 * change event) or opens next — then try to surface the side panel on the
 * broker tab. The literals mirror extension/src/lib/capture.ts; this file
 * stays dependency-free so it builds as a single root-level sw.js.
 */
chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  const msg = message as { type?: unknown; order?: unknown } | null;
  if (msg?.type === "tm:badge") {
    void refreshBadge();
    return;
  }
  if (msg?.type !== "tm:capture" || typeof msg.order !== "object" || msg.order === null) return;
  void chrome.storage.session.set({
    pendingCapture: { ...(msg.order as Record<string, unknown>), capturedAt: Date.now() },
  });
  const tabId = sender.tab?.id;
  if (tabId === undefined) return;
  try {
    // Needs Chrome 116+ and a user gesture; both failures are fine — the
    // capture is staged and prefills whenever the panel opens.
    void chrome.sidePanel?.open?.({ tabId }).catch(() => undefined);
  } catch {
    /* degrade silently */
  }
});

/**
 * Rules-nudge toolbar badge.
 *
 * The badge nudges daily rule discipline: it shows the count of UNTICKED daily
 * rules once the day has at least one trade, and stays empty otherwise. All the
 * actual journal querying happens in the side panel (which already holds a DB
 * connection) — the panel writes a snapshot to chrome.storage.session and pokes
 * this SW with a "tm:badge" message. The SW only ever re-applies that cached
 * snapshot, so the badge survives the MV3 service worker dying without ever
 * hammering the DB.
 *
 * Refresh happens on three triggers: (a) the panel's "tm:badge" message after a
 * trade-save / rule check-off, (b) a low-frequency chrome.alarms tick (~60s —
 * NEVER setInterval, which dies with the service worker), and (c) SW
 * install/startup. The alarm also handles the IST day rollover: a snapshot from
 * an earlier day is treated as "no trades yet" and the badge clears.
 *
 * The constants + the IST-day helper + the decision are mirrored from
 * extension/src/lib/badge-sync.ts (the panel-side source of truth); this file
 * stays dependency-free so it builds as a single root-level sw.js.
 */
const BADGE_STATE_KEY = "badgeState";
const BADGE_COLOR = "#dc2626";
const BADGE_ALARM = "tm-rules-badge";
const BADGE_ALARM_PERIOD_MIN = 1; // ~60s; MV3 floors alarm periods at 30s anyway

interface BadgeSnapshot {
  tradesToday: number;
  untickedRules: number;
  signedIn: boolean;
  mode: "hosted" | "byod" | "local" | null;
  day: string;
}

function isBadgeSnapshot(v: unknown): v is BadgeSnapshot {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.tradesToday === "number" &&
    typeof s.untickedRules === "number" &&
    typeof s.signedIn === "boolean" &&
    typeof s.day === "string"
  );
}

/** Fixed UTC+05:30, no DST — the same IST day the journal keys trades on. */
function istDayKey(now: number): string {
  return new Date(now + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function badgeText(snapshot: BadgeSnapshot, currentDay: string): string {
  if (!snapshot.signedIn) return "";
  if (snapshot.mode !== "hosted" && snapshot.mode !== "byod") return "";
  if (snapshot.day !== currentDay) return ""; // stale snapshot → new day, no trades yet
  if (snapshot.tradesToday < 1) return "";
  if (snapshot.untickedRules < 1) return "";
  return String(snapshot.untickedRules);
}

async function applyBadge(text: string): Promise<void> {
  try {
    await chrome.action.setBadgeText({ text });
    if (text) await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  } catch {
    /* action API unavailable on this surface — nothing to badge */
  }
}

/** Reads the cached snapshot and re-applies the badge for the current IST day. */
async function refreshBadge(): Promise<void> {
  let snapshot: unknown;
  try {
    snapshot = (await chrome.storage.session.get(BADGE_STATE_KEY))[BADGE_STATE_KEY];
  } catch {
    return; // no snapshot yet (fresh SW) — leave the badge as-is
  }
  if (!isBadgeSnapshot(snapshot)) {
    await applyBadge("");
    return;
  }
  await applyBadge(badgeText(snapshot, istDayKey(Date.now())));
  // Honor sign-out: stop the ticking once nobody is signed in (the next
  // sign-in's tm:badge message re-arms it). While signed in, keep it armed.
  if (snapshot.signedIn) ensureBadgeAlarm();
  else void chrome.alarms?.clear(BADGE_ALARM);
}

function ensureBadgeAlarm(): void {
  // Idempotent: re-creating an alarm with the same name just resets its period.
  void chrome.alarms?.create(BADGE_ALARM, { periodInMinutes: BADGE_ALARM_PERIOD_MIN });
}

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === BADGE_ALARM) void refreshBadge();
});

chrome.runtime.onInstalled.addListener(() => {
  ensureBadgeAlarm();
  void refreshBadge();
});
chrome.runtime.onStartup.addListener(() => {
  ensureBadgeAlarm();
  void refreshBadge();
});
ensureBadgeAlarm();
void refreshBadge();
