import type { BrokerCaptureAdapter } from "../brokers/types";

/**
 * Broker-agnostic content-script runtime: watches the page for the adapter's
 * order panel and anchors a single "Log in TradeMarkk" affordance to it.
 * Clicking reads the order fields (only the order fields) and hands them to
 * the service worker, which stages them for the side panel's quick log.
 *
 * Ground rules (ADR v2):
 *  - injected ONLY after the user enables capture in panel settings
 *    (optional host permission — Chrome's own prompt);
 *  - zero console output, zero thrown errors: broker DOM drift makes the
 *    button disappear, never breaks the page;
 *  - inline styles only — no stylesheet injection into the broker page.
 */

/** Mirrors extension/src/lib/capture.ts (content bundles are standalone IIFEs). */
const CAPTURE_MESSAGE_TYPE = "tm:capture";

const BTN_ATTR = "data-tm-capture";
const RESCAN_MS = 250;
const LABEL = "Log in TradeMarkk";

export function runCapture(adapter: BrokerCaptureAdapter): void {
  // Extension got reloaded/removed → this orphaned script must stay inert.
  if (typeof chrome === "undefined" || !chrome.runtime?.id) return;

  let queued = false;

  const ensureButton = (): void => {
    try {
      const existing = document.querySelector(`[${BTN_ATTR}]`);
      const panel = adapter.findOrderPanel(document);
      if (!panel || !adapter.readOrder(panel)) {
        existing?.remove();
        return;
      }
      if (existing && existing.parentElement === panel) return;
      existing?.remove();
      // Kite's order window is a positioned (draggable) dialog; if a future
      // DOM makes it static, give the pill an anchor without moving anything.
      if (getComputedStyle(panel).position === "static") panel.style.position = "relative";
      panel.appendChild(buildButton(adapter));
    } catch {
      /* degrade silently */
    }
  };

  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      if (!chrome.runtime?.id) {
        observer.disconnect();
        document.querySelector(`[${BTN_ATTR}]`)?.remove();
        return;
      }
      ensureButton();
    }, RESCAN_MS);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  ensureButton();
}

function buildButton(adapter: BrokerCaptureAdapter): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute(BTN_ATTR, String(adapter.version));
  btn.textContent = LABEL;
  // Hangs just below the order dialog, styled like a small extension pill.
  btn.style.cssText =
    "position:absolute;top:100%;left:0;margin-top:6px;z-index:2147483647;" +
    "padding:6px 12px;border:1px solid #3f3f46;border-radius:8px;cursor:pointer;" +
    "background:#1b1b1f;color:#fafafa;font:600 12px/1.2 system-ui,sans-serif;" +
    "box-shadow:0 4px 12px rgb(0 0 0 / 0.35);";

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    try {
      const panel = btn.parentElement;
      const order = panel ? adapter.readOrder(panel) : null;
      if (!order || !chrome.runtime?.id) {
        btn.remove();
        return;
      }
      chrome.runtime.sendMessage({ type: CAPTURE_MESSAGE_TYPE, order }).then(
        () => {
          btn.textContent = "Sent to TradeMarkk";
          setTimeout(() => {
            btn.textContent = LABEL;
          }, 2000);
        },
        () => btn.remove() // no receiver — extension is gone
      );
    } catch {
      btn.remove();
    }
  });
  return btn;
}
