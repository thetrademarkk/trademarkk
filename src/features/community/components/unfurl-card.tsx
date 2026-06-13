"use client";

import * as React from "react";
import Image from "next/image";
import { Globe } from "lucide-react";
import type { LinkUnfurl } from "../unfurl";

/**
 * Rich link-preview card (LinkedIn / Twitter style) rendered below a post when
 * its body contains a link. The image, when present, comes from the page's
 * og:image and is rendered through next/image so the browser only ever loads it
 * same-origin via `/_next/image` (satisfies the strict img-src CSP). When there
 * is no usable image we show a lucide Globe placeholder instead. Opening the
 * link always uses a new tab with rel=noopener.
 *
 * All text here is plain (sanitized server-side) — no HTML is ever rendered.
 */
export function UnfurlCard({ unfurl }: { unfurl: LinkUnfurl }) {
  const [imgOk, setImgOk] = React.useState(Boolean(unfurl.image));
  let host = unfurl.siteName ?? "";
  try {
    if (!host) host = new URL(unfurl.url).host.replace(/^www\./, "");
  } catch {
    /* malformed — leave host blank */
  }

  return (
    <a
      href={unfurl.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      data-unfurl-card
      className="mt-3 flex overflow-hidden rounded-xl border bg-surface-2 transition-colors hover:border-border/80"
    >
      <div className="relative aspect-square w-24 shrink-0 bg-surface sm:w-32">
        {imgOk && unfurl.image ? (
          <Image
            src={unfurl.image}
            alt=""
            fill
            sizes="(max-width: 640px) 96px, 128px"
            className="object-cover"
            onError={() => setImgOk(false)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted">
            <Globe className="h-7 w-7" aria-hidden />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-0.5 px-3 py-2.5">
        {host && (
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted">
            {host}
          </p>
        )}
        <p className="line-clamp-2 text-sm font-semibold leading-snug">{unfurl.title}</p>
        {unfurl.description && (
          <p className="line-clamp-2 text-xs leading-snug text-muted">{unfurl.description}</p>
        )}
      </div>
    </a>
  );
}
