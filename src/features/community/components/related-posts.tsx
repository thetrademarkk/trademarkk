"use client";

import Link from "next/link";
import { Heart, MessageCircle } from "lucide-react";
import { timeAgo } from "@/lib/utils";
import { formatCount } from "../format";
import type { RelatedPostView } from "../types";
import { CommunityAvatar } from "./avatar";

/** Compact "keep reading" rail under the comment thread on the post detail page. */
export function RelatedPosts({ posts, byTag }: { posts: RelatedPostView[]; byTag: boolean }) {
  if (posts.length === 0) return null;
  return (
    <section aria-label="Related posts" className="space-y-3">
      <h2 className="text-sm font-semibold">
        {byTag ? "More like this" : "More from the community"}
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {posts.map((p) => {
          const excerpt = (p.title ?? p.body).replace(/\s+/g, " ").trim();
          return (
            <li key={p.id}>
              <Link
                href={`/community/post/${p.id}`}
                className="flex h-full flex-col gap-2 rounded-xl border bg-surface p-3 transition-colors hover:border-accent/50"
              >
                <p className="line-clamp-2 text-sm font-medium leading-snug">{excerpt}</p>
                <div className="mt-auto flex items-center gap-2 text-xs text-muted">
                  <CommunityAvatar
                    size="sm"
                    avatar={p.author.avatar}
                    username={p.author.username}
                    displayName={p.author.displayName}
                  />
                  <span className="min-w-0 truncate">{p.author.displayName}</span>
                  <span aria-hidden>·</span>
                  <time dateTime={p.createdAt} className="shrink-0">
                    {timeAgo(p.createdAt)}
                  </time>
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    {p.likeCount > 0 && (
                      <span className="flex items-center gap-1">
                        <Heart className="h-3.5 w-3.5" aria-hidden />
                        <span className="font-money">{formatCount(p.likeCount)}</span>
                      </span>
                    )}
                    {p.commentCount > 0 && (
                      <span className="flex items-center gap-1">
                        <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                        <span className="font-money">{formatCount(p.commentCount)}</span>
                      </span>
                    )}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
