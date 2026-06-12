"use client";

import * as React from "react";
import Image from "next/image";
import { Play, Volume2, VolumeX } from "lucide-react";

/**
 * Ambient product walkthrough — autoplays muted/looping/inline, but lazily:
 * the <video> element doesn't even mount (so nothing is ever preloaded) until
 * the section first scrolls into view, and playback pauses whenever it leaves
 * the viewport. The poster <Image> is all that exists before that, so the
 * video never touches the critical rendering path.
 *
 * Reduced-motion users keep the click-to-play poster — no auto playback —
 * and get native controls once they opt in. Sound is opt-in for everyone via
 * a subtle corner unmute toggle. (The current walkthrough encode carries no
 * audio track yet — the toggle is wired for the next recording, which mixes
 * in soft UI click sounds; see the roadmap backlog.)
 */
export function DemoVideo({ duration }: { duration: string }) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [reduced, setReduced] = React.useState(false);
  const [active, setActive] = React.useState(false);
  const [muted, setMuted] = React.useState(true);

  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReduced(true);
      return;
    }
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        // First intersect mounts the video; its autoPlay attribute starts it.
        if (visible) setActive(true);
        const v = videoRef.current;
        if (!v) return;
        if (visible) void v.play().catch(() => {});
        else v.pause();
      },
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const showVideo = active; // reduced-motion: only after an explicit click

  return (
    <div ref={wrapRef} className="relative mx-auto w-full max-w-4xl" data-testid="demo-video">
      <div className="absolute -inset-6 rounded-3xl bg-accent/10 blur-3xl" aria-hidden />
      <div className="relative overflow-hidden rounded-xl border bg-surface shadow-2xl">
        <div className="flex items-center gap-1.5 border-b bg-surface-2/60 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-loss/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-profit/70" />
          <span className="ml-3 text-[11px] text-muted">TradeMark — product walkthrough</span>
        </div>
        {showVideo ? (
          <div className="relative">
            <video
              ref={videoRef}
              autoPlay
              muted={muted}
              loop
              playsInline
              controls={reduced}
              preload="none"
              poster="/demo/poster.jpg"
              width={1280}
              height={800}
              className="block h-auto w-full"
              aria-label="TradeMark product walkthrough"
              data-testid="walkthrough-video"
              onClick={(e) => {
                if (reduced) return; // native controls own the clicks
                const v = e.currentTarget;
                if (v.paused) void v.play().catch(() => {});
                else setMuted((m) => !m);
              }}
            >
              <source src="/demo/walkthrough.webm" type="video/webm" />
              <source src="/demo/walkthrough.mp4" type="video/mp4" />
            </video>
            {!reduced && (
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                aria-label={muted ? "Unmute the walkthrough" : "Mute the walkthrough"}
                aria-pressed={!muted}
                className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white"
              >
                {muted ? (
                  <VolumeX className="h-4 w-4" aria-hidden />
                ) : (
                  <Volume2 className="h-4 w-4" aria-hidden />
                )}
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            // Reduced motion: explicit opt-in. Otherwise this is just the
            // pre-intersect poster — clicking it starts playback early.
            onClick={() => setActive(true)}
            aria-label="Play the product walkthrough video"
            className="group relative block w-full"
          >
            <Image
              src="/demo/poster.jpg"
              alt="Preview frame of the TradeMark walkthrough: the dashboard with equity curve and rules checklist"
              width={1280}
              height={800}
              loading="lazy"
              sizes="(max-width: 56rem) 100vw, 56rem"
              className="block h-auto w-full"
            />
            {reduced && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/40">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-solid text-accent-fg shadow-2xl ring-4 ring-white/25 transition-transform duration-300 group-hover:scale-110 sm:h-20 sm:w-20">
                  <Play
                    className="h-7 w-7 translate-x-0.5 sm:h-8 sm:w-8"
                    fill="currentColor"
                    aria-hidden
                  />
                </span>
              </span>
            )}
            <span className="absolute bottom-3 right-3 rounded-md bg-black/65 px-2 py-0.5 font-money text-xs text-white">
              {duration}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
