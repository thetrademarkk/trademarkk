"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bookmark,
  Flag,
  Heart,
  Link2,
  Loader2,
  MessageCircle,
  Pin,
  PinOff,
  Share2,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { cn, timeAgo } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ApiError,
  useDeletePost,
  useFollowAuthor,
  usePinPost,
  useRecordShare,
  useToggleBlock,
  useToggleBookmark,
  useToggleLike,
} from "../api";
import { formatCount, formatPostDate } from "../format";
import type { PostView } from "../types";
import { CommunityAvatar } from "./avatar";
import { TradeCardView } from "./trade-card-view";
import { RichText } from "./rich-text";
import { SignInGate } from "./sign-in-gate";
import { ReportDialog } from "./report-dialog";

export function PostCard({
  post,
  detail = false,
  authorFollowedByMe,
  showPinned = false,
}: {
  post: PostView;
  detail?: boolean;
  /** Detail page only — renders the Follow chip in the author header when provided. */
  authorFollowedByMe?: boolean;
  /** Profile page only — shows the "Pinned" marker on the author's pinned post. */
  showPinned?: boolean;
}) {
  const router = useRouter();
  const toggleLike = useToggleLike();
  const toggleBookmark = useToggleBookmark();
  const toggleBlock = useToggleBlock(post.author.username);
  const recordShare = useRecordShare();
  const followAuthor = useFollowAuthor(post.id, post.author.username);
  const pinPost = usePinPost();
  const deletePost = useDeletePost();
  const confirmDialog = useConfirm();
  const [gateOpen, setGateOpen] = React.useState(false);
  const [reportOpen, setReportOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState(detail);
  const pendingAction = React.useRef<(() => void) | null>(null);

  // Attempt → 401 → gate → retry. No client-side session pre-checks.
  const onUnauthorized = (retry: () => void) => {
    pendingAction.current = retry;
    setGateOpen(true);
  };
  const like = () =>
    toggleLike.mutate(post.id, {
      onError: (e) => e instanceof ApiError && e.status === 401 && onUnauthorized(like),
    });
  const bookmark = () =>
    toggleBookmark.mutate(post.id, {
      onError: (e) => e instanceof ApiError && e.status === 401 && onUnauthorized(bookmark),
      onSuccess: (r) =>
        toast.success(r.bookmarked ? "Saved — find it under Saved" : "Removed from Saved"),
    });

  const postUrl = () => `${location.origin}/community/post/${post.id}`;
  const share = async () => {
    const url = postUrl();
    if (navigator.share) {
      try {
        await navigator.share({ title: post.title ?? "Trade idea on TradeMark", url });
      } catch {
        return; // reader closed the share sheet — nothing was shared
      }
    } else {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    }
    recordShare.mutate(post.id);
  };

  const follow = () =>
    followAuthor.mutate(undefined, {
      onError: (e) =>
        e instanceof ApiError && e.status === 401
          ? onUnauthorized(follow)
          : toast.error("Could not follow"),
    });

  const handlePin = () =>
    pinPost.mutate(post.id, {
      onSuccess: (r) =>
        toast.success(
          r.pinned ? "Pinned to the top of your profile" : "Unpinned from your profile"
        ),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update the pin"),
    });

  const handleDelete = async () => {
    const ok = await confirmDialog({
      title: "Delete this post?",
      description: "Comments and likes go with it. This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    await deletePost.mutateAsync(post.id);
    toast.success("Post deleted");
    if (detail) router.replace("/community");
  };

  const handleBlock = async () => {
    const ok = await confirmDialog({
      title: `Block @${post.author.username}?`,
      description:
        "You won't see their posts or comments anywhere. You can unblock from their profile.",
      confirmLabel: "Block",
      destructive: true,
    });
    if (!ok) return;
    toggleBlock.mutate(undefined, {
      onSuccess: () => toast.success(`Blocked @${post.author.username}`),
      onError: (e) =>
        e instanceof ApiError && e.status === 401
          ? onUnauthorized(handleBlock)
          : toast.error("Could not block"),
    });
  };

  const longBody = post.body.length > 420;
  const body = expanded || !longBody ? post.body : post.body.slice(0, 400).trimEnd() + "…";

  return (
    <article className="rounded-xl border bg-surface p-4 transition-colors hover:border-border/80">
      {showPinned && post.pinned && (
        <p
          data-pinned-marker
          className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted"
        >
          <Pin className="h-3 w-3" aria-hidden /> Pinned
        </p>
      )}
      <header className="flex items-center gap-2.5">
        <Link
          href={`/community/u/${post.author.username}`}
          aria-label={`${post.author.displayName}'s profile`}
        >
          <CommunityAvatar
            username={post.author.username}
            displayName={post.author.displayName}
            avatar={post.author.avatar}
          />
        </Link>
        <div className="min-w-0 leading-tight">
          <Link
            href={`/community/u/${post.author.username}`}
            className="text-sm font-semibold hover:underline"
          >
            {post.author.displayName}
          </Link>
          <p className="text-xs text-muted">
            <Link href={`/community/u/${post.author.username}`} className="hover:text-accent">
              @{post.author.username}
            </Link>
            {" · "}
            {/* suppressHydrationWarning: ISR documents render the relative
                label at revalidate time; it can lag by minutes at hydration. */}
            <time
              dateTime={post.createdAt}
              title={formatPostDate(post.createdAt)}
              suppressHydrationWarning
            >
              {detail ? formatPostDate(post.createdAt) : timeAgo(post.createdAt)}
            </time>
          </p>
        </div>
        {detail && !post.mine && authorFollowedByMe !== undefined && (
          <button
            onClick={follow}
            aria-pressed={authorFollowedByMe}
            aria-label={
              authorFollowedByMe
                ? `Unfollow ${post.author.displayName}`
                : `Follow ${post.author.displayName}`
            }
            className={cn(
              "ml-auto flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              authorFollowedByMe
                ? "border-border text-muted hover:border-loss/40 hover:text-loss"
                : "border-accent/40 bg-accent/10 text-accent hover:bg-accent/20"
            )}
          >
            {followAuthor.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : authorFollowedByMe ? (
              <UserCheck className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
            )}
            {authorFollowedByMe ? "Following" : "Follow"}
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Post options"
            className={cn(
              "rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground",
              (!detail || post.mine || authorFollowedByMe === undefined) && "ml-auto"
            )}
          >
            <span aria-hidden>⋯</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => {
                void navigator.clipboard.writeText(postUrl());
                toast.success("Link copied");
                recordShare.mutate(post.id);
              }}
            >
              <Link2 /> Copy link
            </DropdownMenuItem>
            {post.mine ? (
              <>
                <DropdownMenuItem onClick={handlePin}>
                  {post.pinned ? (
                    <>
                      <PinOff /> Unpin from profile
                    </>
                  ) : (
                    <>
                      <Pin /> Pin to profile
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDelete} className="text-loss">
                  <Trash2 /> Delete post
                </DropdownMenuItem>
              </>
            ) : (
              <>
                <DropdownMenuItem onClick={() => setReportOpen(true)}>
                  <Flag /> Report
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleBlock} className="text-loss">
                  <UserX /> Block @{post.author.username}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="mt-3">
        {post.title && (
          <h2
            className={cn(
              "font-semibold",
              detail ? "text-xl leading-tight tracking-tight" : "text-base leading-snug"
            )}
          >
            {detail ? (
              post.title
            ) : (
              <Link href={`/community/post/${post.id}`} className="hover:text-accent">
                {post.title}
              </Link>
            )}
          </h2>
        )}
        <p
          className={cn(
            "mt-1 whitespace-pre-wrap text-foreground/90",
            detail ? "mt-2 text-[15px] leading-7" : "text-sm leading-6"
          )}
        >
          <RichText text={body} />
        </p>
        {longBody && !expanded && (
          <button
            className="mt-1 text-xs font-medium text-accent hover:underline"
            onClick={() => setExpanded(true)}
          >
            Show more
          </button>
        )}
      </div>

      {post.tradeCard && <TradeCardView card={post.tradeCard} />}

      {post.images.length > 0 && (
        <div className={cn("mt-3 grid gap-2", post.images.length > 1 && "grid-cols-2")}>
          {post.images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={src}
              alt={`Chart shared by ${post.author.displayName}`}
              className="w-full rounded-lg border"
              loading="lazy"
            />
          ))}
        </div>
      )}

      {post.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {post.tags.map((t) => (
            <Link
              key={t}
              href={`/community?tag=${encodeURIComponent(t)}`}
              className="rounded-md bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-accent/20"
            >
              #{t}
            </Link>
          ))}
        </div>
      )}

      <footer className="mt-3 flex items-center gap-1 border-t pt-2">
        <button
          aria-label={post.likedByMe ? "Unlike" : "Like"}
          aria-pressed={post.likedByMe}
          onClick={like}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
            post.likedByMe ? "text-loss" : "text-muted hover:bg-surface-2 hover:text-foreground"
          )}
        >
          <Heart className={cn("h-4 w-4", post.likedByMe && "fill-current")} aria-hidden />
          {post.likeCount > 0 && <span className="font-money">{formatCount(post.likeCount)}</span>}
        </button>
        <Link
          href={`/community/post/${post.id}`}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          aria-label={`${post.commentCount} comments`}
        >
          <MessageCircle className="h-4 w-4" aria-hidden />
          {post.commentCount > 0 && (
            <span className="font-money">{formatCount(post.commentCount)}</span>
          )}
        </Link>
        <button
          aria-label={post.bookmarkedByMe ? "Remove from saved" : "Save post"}
          aria-pressed={post.bookmarkedByMe}
          onClick={bookmark}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
            post.bookmarkedByMe
              ? "text-accent"
              : "text-muted hover:bg-surface-2 hover:text-foreground"
          )}
        >
          <Bookmark className={cn("h-4 w-4", post.bookmarkedByMe && "fill-current")} aria-hidden />
        </button>
        <button
          aria-label="Share post"
          onClick={share}
          className="ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <Share2 className="h-4 w-4" aria-hidden />
          {post.shareCount > 0 && (
            <span className="font-money">{formatCount(post.shareCount)}</span>
          )}
        </button>
      </footer>

      <SignInGate
        open={gateOpen}
        onOpenChange={setGateOpen}
        onAuthed={() => {
          pendingAction.current?.();
          pendingAction.current = null;
        }}
      />
      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        targetType="post"
        targetId={post.id}
      />
    </article>
  );
}
