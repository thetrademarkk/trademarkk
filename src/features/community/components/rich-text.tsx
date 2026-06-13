import Link from "next/link";
import React from "react";

/**
 * Plain-text-safe rich rendering: linkifies @handles (→ profiles), #hashtags
 * (→ tag feed), $cashtags (→ ticker search) and URLs. No HTML is ever parsed —
 * XSS-free by construction.
 */
const TOKEN = /(@[a-z0-9_]{3,20}|#[a-z0-9-]{2,20}|\$[A-Za-z0-9&-]{1,20}|https?:\/\/[^\s<>"')\]]+)/g;

export function RichText({ text }: { text: string }) {
  const parts = text.split(TOKEN);
  return (
    <>
      {parts.map((part, i) => {
        if (/^@[a-z0-9_]{3,20}$/.test(part)) {
          return (
            <Link
              key={i}
              href={`/community/u/${part.slice(1)}`}
              className="text-accent hover:underline"
            >
              {part}
            </Link>
          );
        }
        if (/^#[a-z0-9-]{2,20}$/.test(part)) {
          return (
            <Link
              key={i}
              href={`/community?tag=${encodeURIComponent(part.slice(1))}`}
              className="text-accent hover:underline"
            >
              {part}
            </Link>
          );
        }
        if (/^\$[A-Za-z0-9&-]{1,20}$/.test(part)) {
          return (
            <Link
              key={i}
              href={`/community?q=${encodeURIComponent(part.slice(1).toUpperCase())}`}
              className="text-accent hover:underline"
            >
              {`$${part.slice(1).toUpperCase()}`}
            </Link>
          );
        }
        if (/^https?:\/\//.test(part)) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-accent underline break-all"
            >
              {part}
            </a>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </>
  );
}
