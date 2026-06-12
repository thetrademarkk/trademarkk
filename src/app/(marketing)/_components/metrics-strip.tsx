"use client";

import * as React from "react";
import type { PublicStats } from "@/lib/public-stats";

/**
 * Live platform metrics — honest aggregates from /api/public/stats (cached
 * 10 min server-side + CDN). Counts animate up on scroll-into-view; reduced
 * motion (or any failure) renders the final numbers instantly. The section
 * keeps a fixed shape while loading so there is zero layout shift.
 */
const ITEMS: { key: keyof Omit<PublicStats, "generatedAt">; label: string; suffix?: string }[] = [
  { key: "traders", label: "registered traders" },
  { key: "active30d", label: "active last 30 days" },
  { key: "posts", label: "community posts" },
  { key: "longestStreak", label: "longest public streak", suffix: " days" },
];

function easeOutCubic(p: number) {
  return 1 - Math.pow(1 - p, 3);
}

function CountUp({ value, run }: { value: number; run: boolean }) {
  const [display, setDisplay] = React.useState(0);
  React.useEffect(() => {
    if (!run) return;
    if (value === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const dur = 1200;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setDisplay(Math.round(value * easeOutCubic(p)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, run]);
  return <>{display.toLocaleString("en-IN")}</>;
}

export function MetricsStrip() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [stats, setStats] = React.useState<PublicStats | "error" | null>(null);
  const [inView, setInView] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/public/stats")
      .then((r) => (r.ok ? (r.json() as Promise<PublicStats>) : Promise.reject(new Error())))
      .then((d) => !cancelled && setStats(d))
      .catch(() => !cancelled && setStats("error"));
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -40px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const ready = stats !== null && stats !== "error";

  return (
    <div ref={ref} data-testid="metrics-strip">
      <p className="flex items-center justify-center gap-2 text-xs text-muted">
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-profit/60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-profit" />
        </span>
        Live from the platform — real numbers, no marketing math
      </p>
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 md:divide-x md:divide-border">
        {ITEMS.map((item) => (
          <div key={item.key} className="px-4 py-2 text-center">
            <p
              className="font-money text-2xl font-bold text-foreground md:text-3xl"
              data-stat={item.key}
            >
              {ready ? (
                <>
                  <CountUp value={stats[item.key]} run={inView} />
                  {item.suffix}
                </>
              ) : stats === "error" ? (
                "—"
              ) : (
                <span className="inline-block h-[1em] w-12 animate-pulse rounded bg-surface-2 align-middle" />
              )}
            </p>
            <p className="micro-label mt-1">{item.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
