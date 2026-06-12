"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Batched first-party page-view tracking: events queue in localStorage (with
 * their real timestamps) and flush as ONE request when the tab hides, the page
 * unloads, the queue grows past a threshold, or on next load (crash recovery).
 * One DB write per session instead of one per page view — nothing is dropped.
 */
const KEY = "tm.track-queue";
const MAX_QUEUE = 25; // safety flush so a marathon session can't overflow sendBeacon

type Ev = { path: string; ts: number };

function readQueue(): Ev[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Ev[];
  } catch {
    return [];
  }
}
function writeQueue(q: Ev[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* storage full/blocked — analytics must never break the app */
  }
}

function flush() {
  const q = readQueue();
  if (q.length === 0) return;
  const payload = JSON.stringify({ events: q.slice(0, 100) });
  try {
    const ok = navigator.sendBeacon?.(
      "/api/track",
      new Blob([payload], { type: "application/json" })
    );
    if (!ok) {
      void fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      });
    }
    writeQueue(q.slice(100));
  } catch {
    /* keep the queue for the next opportunity */
  }
}

export function AnalyticsTracker() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  // Crash recovery + lifecycle flushes (tab switch, close, browser quit).
  useEffect(() => {
    flush(); // leftovers from a previous session
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush); // Safari / bfcache
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  useEffect(() => {
    if (!pathname || pathname === last.current) return;
    last.current = pathname;
    const q = readQueue();
    q.push({ path: pathname, ts: Date.now() });
    writeQueue(q);
    if (q.length >= MAX_QUEUE) flush();
  }, [pathname]);

  return null;
}
