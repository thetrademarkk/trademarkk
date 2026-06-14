"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Registers the service worker in production and surfaces a user-gated update
 * flow. In development it actively unregisters any previously-installed SW and
 * clears its caches — a stale production SW controlling localhost otherwise
 * serves broken assets.
 *
 * Update flow (PWA-04): the SW does NOT call skipWaiting on install, so a new
 * worker waits. When one finishes installing while a controller already exists,
 * we show a "New version — reload" toast; only when the user accepts do we tell
 * the waiting worker to activate (postMessage "SKIP_WAITING") and reload once it
 * takes control. This avoids swapping assets mid-session.
 */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) void reg.unregister();
      });
      if ("caches" in window) {
        void caches.keys().then((keys) => {
          for (const key of keys) void caches.delete(key);
        });
      }
      return;
    }

    let reloading = false;
    const onControllerChange = () => {
      // The new worker took control after the user accepted the update.
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const promptUpdate = (worker: ServiceWorker) => {
      toast("A new version of TradeMarkk is available.", {
        duration: Infinity,
        action: {
          label: "Reload",
          onClick: () => worker.postMessage("SKIP_WAITING"),
        },
      });
    };

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // A worker may already be waiting (installed before this page loaded).
        if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);

        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // "installed" + an existing controller == an update (not first install).
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              promptUpdate(installing);
            }
          });
        });
      })
      .catch(() => {
        /* PWA is progressive enhancement — never block the app on SW failure */
      });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
