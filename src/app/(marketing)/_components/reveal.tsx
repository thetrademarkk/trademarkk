"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Fade-and-rise on scroll into view — CSS transitions + IntersectionObserver,
 * no animation library. Reduced-motion users (and any IO failure) get content
 * shown immediately; the global reduced-motion rule also zeroes transitions.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  /** Seconds, matching the old motion-based API. */
  delay?: number;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -72px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "transition-[opacity,transform] duration-700 will-change-[opacity,transform]",
        "ease-[cubic-bezier(0.21,0.65,0.36,1)]",
        shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
        className
      )}
      style={delay ? { transitionDelay: `${delay}s` } : undefined}
    >
      {children}
    </div>
  );
}
