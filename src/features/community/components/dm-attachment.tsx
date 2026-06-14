"use client";

import * as React from "react";
import Image from "next/image";
import { ExternalLink, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMessageUnfurl } from "../api";
import type { DmAttachment } from "../types";
import { UnfurlCard } from "./unfurl-card";

/**
 * Renders a DM message's first-link attachment beneath the bubble — ZERO-INFRA:
 *
 *  • An IMAGE url (https + image extension) renders as an inline preview through
 *    next/image, so the BROWSER only ever loads `/_next/image?url=…` — same
 *    origin, satisfying the strict `img-src 'self' data: blob:` CSP WITHOUT
 *    relaxing it (the same mechanism the post link-unfurl card uses). Lazy,
 *    size-capped, never executed (no inline SVG; routed through the optimizer),
 *    click-to-open in a new tab.
 *  • A normal LINK renders the existing OG `UnfurlCard`, resolved lazily via the
 *    per-message unfurl endpoint (cache-first, SSRF-safe server fetch). No file
 *    upload, no blob store, no new external dependency.
 */
export function DmAttachment({
  conversationId,
  messageId,
  attachment,
  optimistic,
  mine,
}: {
  conversationId: string;
  messageId: string;
  attachment: DmAttachment;
  /** Skip the network unfurl for an un-acknowledged optimistic bubble. */
  optimistic: boolean;
  mine: boolean;
}) {
  if (attachment.kind === "image") {
    return <DmImage url={attachment.url} mine={mine} />;
  }
  return (
    <DmLinkCard
      conversationId={conversationId}
      messageId={messageId}
      url={attachment.url}
      enabled={!optimistic}
    />
  );
}

function DmImage({ url, mine }: { url: string; mine: boolean }) {
  const [ok, setOk] = React.useState(true);
  if (!ok) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className={cn(
          "mt-1.5 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs",
          mine ? "border-accent-fg/30 text-accent-fg/90" : "text-muted hover:bg-surface-2"
        )}
      >
        <ImageOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{url}</span>
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      data-dm-image
      className="mt-1.5 block overflow-hidden rounded-lg border bg-surface"
    >
      <span className="relative block max-h-64 w-full">
        <Image
          src={url}
          alt="Shared image"
          width={400}
          height={300}
          loading="lazy"
          onError={() => setOk(false)}
          className="h-auto max-h-64 w-full object-contain"
          // Cards are small; cap the optimizer's responsive set.
          sizes="(max-width: 640px) 80vw, 320px"
        />
      </span>
    </a>
  );
}

function DmLinkCard({
  conversationId,
  messageId,
  url,
  enabled,
}: {
  conversationId: string;
  messageId: string;
  url: string;
  enabled: boolean;
}) {
  const { data } = useMessageUnfurl(conversationId, messageId, enabled);
  if (data?.unfurl) {
    return (
      <div className="mt-1.5" data-dm-link-card>
        <UnfurlCard unfurl={data.unfurl} />
      </div>
    );
  }
  // No card resolved (yet / unsafe / nothing to show) — the body already renders
  // the link as a clickable chip via RichText, so show a minimal fallback only
  // while we don't have a card.
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      data-dm-link-fallback
      className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs text-muted hover:bg-surface-2"
    >
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">{url}</span>
    </a>
  );
}
