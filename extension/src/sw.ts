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
