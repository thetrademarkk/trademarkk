"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ComposerTextarea } from "./composer-textarea";
import { ApiError, useEditPost } from "../api";
import { SUGGESTED_TAGS, type PostView } from "../types";
import { extractCashtags } from "../cashtags";
import type { Sentiment } from "../sentiment";
import { SentimentToggle } from "./sentiment-toggle";

/**
 * Inline post editor — reuses the composer's title/body/tags fields (same zod
 * validation runs server-side). Images and the trade card are immutable, so
 * they're not shown here. Esc or Cancel discards; Save PATCHes within the window.
 */
export function EditPostForm({ post, onClose }: { post: PostView; onClose: () => void }) {
  const editPost = useEditPost(post.id);
  const [title, setTitle] = React.useState(post.title ?? "");
  const [body, setBody] = React.useState(post.body);
  // Tags the post already has, surfaced first so the author can toggle them off;
  // any custom (non-suggested) tags are preserved and shown too.
  const [tags, setTags] = React.useState<string[]>(post.tags);
  const [sentiment, setSentiment] = React.useState<Sentiment | null>(post.sentiment);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  // Sentiment stays meaningful only while the body tags a ticker.
  const hasCashtag = React.useMemo(() => extractCashtags(body).length > 0, [body]);

  React.useEffect(() => {
    const el = bodyRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  const tagChoices = React.useMemo(
    () => [...new Set([...post.tags, ...SUGGESTED_TAGS])],
    [post.tags]
  );

  const toggleTag = (t: string) =>
    setTags((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : prev.length < 4 ? [...prev, t] : prev
    );

  // The lean we'll actually send: cleared automatically when the new body has
  // no ticker (mirrors the server's re-gate) so the dirty check stays honest.
  const effectiveSentiment = hasCashtag ? sentiment : null;
  const dirty =
    body.trim() !== post.body ||
    (title.trim() || null) !== (post.title || null) ||
    tags.join(" ") !== post.tags.join(" ") ||
    effectiveSentiment !== post.sentiment;

  const save = async () => {
    if (body.trim().length < 2) {
      toast.error("Say something!");
      return;
    }
    try {
      await editPost.mutateAsync({
        title: title.trim() || undefined,
        body: body.trim(),
        tags,
        sentiment: effectiveSentiment,
      });
      toast.success("Post updated");
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) {
        toast.error("The edit window has passed");
        onClose();
        return;
      }
      toast.error(e instanceof Error ? e.message : "Could not save your edit");
    }
  };

  return (
    <div
      className="mt-3 space-y-3"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={`edit-title-${post.id}`}>Title (optional)</Label>
        <Input
          id={`edit-title-${post.id}`}
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`edit-body-${post.id}`}>Your post</Label>
        <ComposerTextarea
          id={`edit-body-${post.id}`}
          ref={bodyRef}
          rows={5}
          maxLength={5000}
          value={body}
          onValueChange={setBody}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void save();
            }
          }}
          aria-label="Edit post body"
        />
      </div>
      <fieldset>
        <legend className="micro-label mb-1.5">Topics (up to 4)</legend>
        <div className="flex flex-wrap gap-1.5">
          {tagChoices.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tags.includes(t)}
              onClick={() => toggleTag(t)}
              className={cn(
                "rounded-md border px-2 py-0.5 text-xs transition-colors",
                tags.includes(t)
                  ? "border-accent bg-accent/15 text-accent"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"
              )}
            >
              #{t}
            </button>
          ))}
        </div>
      </fieldset>
      <SentimentToggle
        value={sentiment}
        onChange={setSentiment}
        disabled={!hasCashtag}
        idPrefix={`edit-sentiment-${post.id}`}
      />
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={editPost.isPending}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={save}
          disabled={editPost.isPending || !dirty || body.trim().length < 2}
          aria-busy={editPost.isPending}
        >
          {editPost.isPending && <Loader2 className="animate-spin" aria-hidden />}
          Save changes
        </Button>
      </div>
    </div>
  );
}
