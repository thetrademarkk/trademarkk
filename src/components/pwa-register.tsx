"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in production. In development it actively
 * unregisters any previously-installed SW and clears its caches — a stale
 * production SW controlling localhost otherwise serves broken assets.
 */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* PWA is progressive enhancement — never block the app on SW failure */
      });
    } else {
      void navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) void reg.unregister();
      });
      if ("caches" in window) {
        void caches.keys().then((keys) => {
          for (const key of keys) void caches.delete(key);
        });
      }
    }
  }, []);
  return null;
}
