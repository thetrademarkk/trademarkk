"use client";

import * as React from "react";
import Image from "next/image";
import { Play } from "lucide-react";

/**
 * Click-to-play product walkthrough. The <video> element only mounts after
 * the poster is clicked, so nothing is preloaded and the video never touches
 * the critical rendering path. Muted + playsInline so playback starts
 * immediately on every browser, including iOS.
 */
export function DemoVideo({ duration }: { duration: string }) {
  const [playing, setPlaying] = React.useState(false);

  return (
    <div className="relative mx-auto w-full max-w-4xl" data-testid="demo-video">
      <div className="absolute -inset-6 rounded-3xl bg-accent/10 blur-3xl" aria-hidden />
      <div className="relative overflow-hidden rounded-xl border bg-surface shadow-2xl">
        <div className="flex items-center gap-1.5 border-b bg-surface-2/60 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-loss/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-profit/70" />
          <span className="ml-3 text-[11px] text-muted">TradeMark — product walkthrough</span>
        </div>
        {playing ? (
          <video
            autoPlay
            muted
            playsInline
            controls
            poster="/demo/poster.jpg"
            width={1280}
            height={800}
            className="block h-auto w-full"
            aria-label="TradeMark product walkthrough"
          >
            <source src="/demo/walkthrough.webm" type="video/webm" />
            <source src="/demo/walkthrough.mp4" type="video/mp4" />
          </video>
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
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
            <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/40">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-solid text-accent-fg shadow-2xl ring-4 ring-white/25 transition-transform duration-300 group-hover:scale-110 sm:h-20 sm:w-20">
                <Play
                  className="h-7 w-7 translate-x-0.5 sm:h-8 sm:w-8"
                  fill="currentColor"
                  aria-hidden
                />
              </span>
            </span>
            <span className="absolute bottom-3 right-3 rounded-md bg-black/65 px-2 py-0.5 font-money text-xs text-white">
              {duration}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
