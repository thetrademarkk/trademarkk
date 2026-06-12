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
