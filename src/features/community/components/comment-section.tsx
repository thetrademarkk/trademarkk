"use client";

import * as React from "react";
import Link from "next/link";
import { Heart, Loader2, Reply, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ComposerTextarea } from "./composer-textarea";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  ApiError,
  useAddComment,
  useDeleteComment,
  useMyProfile,
  useToggleCommentLike,
} from "../api";
import { formatCount } from "../format";
import type { CommentView } from "../types";
import { CommunityAvatar } from "./avatar";
import { RichText } from "./rich-text";
import { SignInGate } from "./sign-in-gate";

const COMMENT_MAX = 2000;

function CommentItem({
  comment,
  isReply,
  onReply,
  onLike,
  onDelete,
}: {
  comment: CommentView;
  isReply?: boolean;
  onReply: (c: CommentView) => void;
  onLike: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex gap-2.5">
      <Link
        href={`/community/u/${comment.author.username}`}
        aria-label={`${comment.author.displayName}'s profile`}
      >
        <CommunityAvatar
          size="sm"
          avatar={comment.author.avatar}
          username={comment.author.username}
          displayName={comment.author.displayName}
        />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="rounded-lg bg-surface-2/50 px-3 py-2">
          <p className="text-xs text-muted">
            <Link
              href={`/community/u/${comment.author.username}`}
              className="font-medium text-foreground hover:underline"
            >
              {comment.author.displayName}
            </Link>{" "}
            · <time dateTime={comment.createdAt}>{timeAgo(comment.createdAt)}</time>
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm leading-6">
            <RichText text={comment.body} />
          </p>
        </div>
        <div className="mt-1 flex items-center gap-3 px-1 text-xs">
          <button
            aria-label={comment.likedByMe ? "Unlike comment" : "Like comment"}
            aria-pressed={comment.likedByMe}
            onClick={() => onLike(comment.id)}
            className={cn(
              "flex items-center gap-1 font-medium transition-colors",
              comment.likedByMe ? "text-loss" : "text-muted hover:text-foreground"
            )}
          >
            <Heart className={cn("h-3.5 w-3.5", comment.likedByMe && "fill-current")} aria-hidden />
            {comment.likeCount > 0 && (
              <span className="font-money">{formatCount(comment.likeCount)}</span>
            )}
          </button>
          {!isReply && (
            <button
              className="flex items-center gap-1 font-medium text-muted transition-colors hover:text-foreground"
              onClick={() => onReply(comment)}
            >
              <Reply className="h-3.5 w-3.5" aria-hidden /> Reply
            </button>
          )}
          {comment.mine && (
            <button
              aria-label="Delete comment"
              onClick={() => onDelete(comment.id)}
              className="ml-auto text-muted hover:text-loss"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * LinkedIn-style threaded comments: top-level + one reply level, with likes.
 * On phones the composer docks to the bottom of the screen (chat-style) so
 * readers can reply from anywhere in the thread; on desktop it sits inline.
 */
export function CommentSection({ postId, comments }: { postId: string; comments: CommentView[] }) {
  const addComment = useAddComment(postId);
  const deleteComment = useDeleteComment(postId);
  const toggleLike = useToggleCommentLike(postId);
  const confirmDialog = useConfirm();
  const { data: session } = useSession();
  const { data: me } = useMyProfile(Boolean(session));
  const [body, setBody] = React.useState("");
  const [replyTo, setReplyTo] = React.useState<CommentView | null>(null);
  const [gateOpen, setGateOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  const topLevel = comments.filter((c) => !c.parentId);
  const repliesFor = (id: string) => comments.filter((c) => c.parentId === id);

  const startReply = (c: CommentView) => {
    setReplyTo(c);
    setBody(`@${c.author.username} `);
    inputRef.current?.focus();
  };

  const submit = async () => {
    if (!body.trim()) return;
    try {
      await addComment.mutateAsync({ body: body.trim(), parentId: replyTo?.id ?? null });
      setBody("");
      setReplyTo(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setGateOpen(true);
        return;
      }
      toast.error(e instanceof Error ? e.message : "Could not comment");
    }
  };

  const like = (id: string) =>
    toggleLike.mutate(id, {
      onError: (e) => e instanceof ApiError && e.status === 401 && setGateOpen(true),
    });

  return (
    <section aria-label="Comments" className="space-y-4">
      <h2 className="text-sm font-semibold">
        {comments.length === 0
          ? "Comments"
          : `${comments.length} comment${comments.length > 1 ? "s" : ""}`}
      </h2>

      {/* Composer — inline on desktop, docked to the viewport bottom on phones.
          The plain outer div absorbs the section's space-y margin: margins move
          fixed elements too, which would float the dock above the bottom edge. */}
      <div>
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0">
          {replyTo && (
            <p className="mb-2 flex items-center justify-between rounded-lg bg-accent/10 px-3 py-1.5 text-xs text-accent">
              Replying to @{replyTo.author.username}
              <button className="font-medium hover:underline" onClick={() => setReplyTo(null)}>
                Cancel
              </button>
            </p>
          )}
          <div className="flex items-start gap-2.5">
            {me ? (
              <CommunityAvatar
                size="sm"
                avatar={me.avatar}
                username={me.username}
                displayName={me.displayName}
              />
            ) : (
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted"
              >
                <UserRound className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0 flex-1 space-y-2">
              <ComposerTextarea
                ref={inputRef}
                rows={2}
                maxLength={COMMENT_MAX}
                placeholder={replyTo ? "Write your reply…" : "Add your take…"}
                value={body}
                onValueChange={setBody}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                aria-label="Write a comment"
              />
              <div className="flex items-center justify-end gap-3">
                {body.length >= COMMENT_MAX - 200 && (
                  <span className="font-money text-[11px] text-muted" aria-live="polite">
                    {body.length}/{COMMENT_MAX}
                  </span>
                )}
                <Button
                  size="sm"
                  onClick={submit}
                  disabled={addComment.isPending || !body.trim()}
                  aria-busy={addComment.isPending}
                >
                  {addComment.isPending && <Loader2 className="animate-spin" aria-hidden />}
                  {replyTo ? "Reply" : "Comment"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {topLevel.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">Be the first to comment.</p>
      ) : (
        <ul className="space-y-4">
          {topLevel.map((c) => {
            const replies = repliesFor(c.id);
            return (
              <li key={c.id}>
                <CommentItem
                  comment={c}
                  onReply={startReply}
                  onLike={like}
                  onDelete={async (id) =>
                    (await confirmDialog({
                      title: "Delete this comment?",
                      description: "Its replies are deleted too.",
                      confirmLabel: "Delete",
                      destructive: true,
                    })) && deleteComment.mutate(id)
                  }
                />
                {replies.length > 0 && (
                  // Thread rail — makes the reply level scannable at a glance.
                  <div className="ml-[13px] mt-2 space-y-3 border-l-2 border-border/60 pl-4">
                    {replies.map((r) => (
                      <CommentItem
                        key={r.id}
                        comment={r}
                        isReply
                        onReply={startReply}
                        onLike={like}
                        onDelete={async (id) =>
                          (await confirmDialog({
                            title: "Delete this reply?",
                            confirmLabel: "Delete",
                            destructive: true,
                          })) && deleteComment.mutate(id)
                        }
                      />
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <SignInGate open={gateOpen} onOpenChange={setGateOpen} />
    </section>
  );
}
