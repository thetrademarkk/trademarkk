"use client";

import * as React from "react";

/** Medium-style reading progress bar pinned under the header. */
export function ReadingProgress() {
  const [pct, setPct] = React.useState(0);

  React.useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const total = doc.scrollHeight - doc.clientHeight;
      setPct(total > 0 ? Math.min(100, (doc.scrollTop / total) * 100) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="fixed inset-x-0 top-14 z-30 h-0.5 bg-transparent" aria-hidden>
      <div className="h-full bg-accent transition-[width] duration-100" style={{ width: `${pct}%` }} />
    </div>
  );
}
