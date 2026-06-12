import type { BrokerCaptureAdapter, BrokerId, CapturedOrder } from "../brokers/types";

/**
 * Panel/SW side of broker capture: the content script sends a CapturedOrder
 * to the service worker, the SW stages it in chrome.storage.session, and the
 * panel consumes it from there (storage.session events reach the panel
 * whether it was already open or got opened by the capture itself).
 *
 * The literals below are mirrored in sw.ts (dependency-free single-file
 * bundle) and content/run-capture.ts (standalone IIFE) — keep them in sync.
 */
export const CAPTURE_MESSAGE_TYPE = "tm:capture";
export const PENDING_CAPTURE_KEY = "pendingCapture";
/** A capture older than this is stale context, not something to prefill. */
export const CAPTURE_TTL_MS = 5 * 60 * 1000;

const BROKER_IDS: readonly BrokerId[] = ["kite", "upstox", "groww"];

export interface PendingCapture extends CapturedOrder {
  /** Stamped by the service worker when the capture arrived. */
  capturedAt: number;
}

/** Strict shape check — captures cross a privilege boundary (content → panel). */
export function isPendingCapture(v: unknown): v is PendingCapture {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    BROKER_IDS.includes(c.broker as BrokerId) &&
    typeof c.adapterVersion === "number" &&
    typeof c.symbol === "string" &&
    c.symbol.trim().length > 0 &&
    (c.exchange === null || typeof c.exchange === "string") &&
    (c.side === "buy" || c.side === "sell") &&
    (c.qty === null || (typeof c.qty === "number" && Number.isFinite(c.qty))) &&
    (c.price === null || (typeof c.price === "number" && Number.isFinite(c.price))) &&
    typeof c.capturedAt === "number"
  );
}

/** Reads AND clears the staged capture (one prefill per capture). */
export async function takePendingCapture(): Promise<PendingCapture | null> {
  try {
    const stored = (await chrome.storage.session.get(PENDING_CAPTURE_KEY))[PENDING_CAPTURE_KEY];
    if (!isPendingCapture(stored)) return null;
    await chrome.storage.session.remove(PENDING_CAPTURE_KEY);
    return Date.now() - stored.capturedAt <= CAPTURE_TTL_MS ? stored : null;
  } catch {
    return null; // storage.session unavailable — capture is best-effort sugar
  }
}

/** Fires when a capture lands while the panel is already open. */
export function onPendingCapture(cb: (capture: PendingCapture) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName
  ) => {
    if (area !== "session") return;
    const next = changes[PENDING_CAPTURE_KEY]?.newValue;
    if (!isPendingCapture(next)) return;
    void chrome.storage.session.remove(PENDING_CAPTURE_KEY).catch(() => undefined);
    cb(next);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/* ── Enable/disable: dynamic registration behind an optional permission ──── */

const scriptId = (id: BrokerId) => `tm-capture-${id}`;

/** Chrome's registration list is the single source of truth — no shadow flag. */
export async function isCaptureEnabled(adapter: BrokerCaptureAdapter): Promise<boolean> {
  try {
    const scripts = await chrome.scripting.getRegisteredContentScripts({
      ids: [scriptId(adapter.id)],
    });
    return scripts.length > 0;
  } catch {
    return false;
  }
}

/**
 * Asks for the broker origin (Chrome shows its own consent prompt — declining
 * is always honored) and registers the adapter's content script. Must be
 * called from a user gesture.
 */
export async function enableCapture(adapter: BrokerCaptureAdapter): Promise<void> {
  const origins = [adapter.originPattern];
  const granted =
    (await chrome.permissions.contains({ origins })) ||
    (await chrome.permissions.request({ origins }));
  if (!granted) throw new Error("Chrome permission for the broker site was declined.");
  if (await isCaptureEnabled(adapter)) return;
  await chrome.scripting.registerContentScripts([
    {
      id: scriptId(adapter.id),
      js: [adapter.contentScript],
      matches: origins,
      runAt: "document_idle",
      persistAcrossSessions: true,
    },
  ]);
}

/** Unregisters the content script and returns the host permission. */
export async function disableCapture(adapter: BrokerCaptureAdapter): Promise<void> {
  await chrome.scripting
    .unregisterContentScripts({ ids: [scriptId(adapter.id)] })
    .catch(() => undefined);
  await chrome.permissions.remove({ origins: [adapter.originPattern] }).catch(() => undefined);
}
