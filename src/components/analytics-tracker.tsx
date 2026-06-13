"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";

/**
 * Batched first-party analytics: page views AND field web-vitals queue in
 * localStorage (with their real timestamps) and flush as ONE request when the
 * tab hides, the page unloads, the queue grows past a threshold, or on next
 * load (crash recovery). One DB write per session instead of one per event —
 * nothing is dropped. Vitals carry no user id — pure performance samples.
 */
const KEY = "tm.track-queue";
const VITALS_KEY = "tm.vitals-queue";
const MAX_QUEUE = 25; // safety flush so a marathon session can't overflow sendBeacon

type Ev = { path: string; ts: number };
type Vital = { metric: string; value: number; path: string; ts: number };

function read<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as T[];
  } catch {
    return [];
  }
}
function write(key: string, q: unknown[]) {
  try {
    localStorage.setItem(key, JSON.stringify(q));
  } catch {
    /* storage full/blocked — analytics must never break the app */
  }
}

function flush() {
  const events = read<Ev>(KEY);
  const vitals = read<Vital>(VITALS_KEY);
  if (events.length === 0 && vitals.length === 0) return;
  const payload = JSON.stringify({ events: events.slice(0, 100), vitals: vitals.slice(0, 25) });
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
    write(KEY, events.slice(100));
    write(VITALS_KEY, vitals.slice(25));
  } catch {
    /* keep the queue for the next opportunity */
  }
}

/** web-vitals fires each metric once per page load — queue it for the next flush. */
function queueVital(m: Metric) {
  const q = read<Vital>(VITALS_KEY);
  q.push({
    metric: m.name,
    value: m.value,
    path: window.location.pathname,
    ts: Date.now(),
  });
  write(VITALS_KEY, q.slice(-50));
}

export function AnalyticsTracker() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  // Crash recovery + lifecycle flushes (tab switch, close, browser quit).
  useEffect(() => {
    flush(); // leftovers from a previous session
    onLCP(queueVital);
    onCLS(queueVital);
    onINP(queueVital);
    onFCP(queueVital);
    onTTFB(queueVital);
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
    const q = read<Ev>(KEY);
    q.push({ path: pathname, ts: Date.now() });
    write(KEY, q);
    if (q.length >= MAX_QUEUE) flush();
  }, [pathname]);

  return null;
}
