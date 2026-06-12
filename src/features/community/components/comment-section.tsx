"use client";

import * as React from "react";
import Link from "next/link";
import { Heart, Loader2, Reply, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ApiError, useAddComment, useDeleteComment, useToggleCommentLike } from "../api";
import type { CommentView } from "../types";
import { CommunityAvatar } from "./avatar";
import { RichText } from "./rich-text";
import { SignInGate } from "./sign-in-gate";

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
    <div className={cn("flex gap-2.5", isReply && "ml-9 mt-2")}>
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
            {comment.likeCount > 0 && <span className="font-money">{comment.likeCount}</span>}
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

/** LinkedIn-style threaded comments: top-level + one reply level, with likes. */
export function CommentSection({ postId, comments }: { postId: string; comments: CommentView[] }) {
  const addComment = useAddComment(postId);
  const deleteComment = useDeleteComment(postId);
  const toggleLike = useToggleCommentLike(postId);
  const confirmDialog = useConfirm();
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

      <div className="space-y-2">
        {replyTo && (
          <p className="flex items-center justify-between rounded-lg bg-accent/10 px-3 py-1.5 text-xs text-accent">
            Replying to @{replyTo.author.username}
            <button className="font-medium hover:underline" onClick={() => setReplyTo(null)}>
              Cancel
            </button>
          </p>
        )}
        <Textarea
          ref={inputRef}
          rows={2}
          maxLength={2000}
          placeholder={replyTo ? "Write your reply…" : "Add your take…"}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-label="Write a comment"
        />
        <div className="flex justify-end">
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

      {topLevel.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">Be the first to comment.</p>
      ) : (
        <ul className="space-y-4">
          {topLevel.map((c) => (
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
              {repliesFor(c.id).map((r) => (
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
            </li>
          ))}
        </ul>
      )}

      <SignInGate open={gateOpen} onOpenChange={setGateOpen} />
    </section>
  );
}
