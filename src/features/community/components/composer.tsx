"use client";

import * as React from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { compressImage } from "@/lib/images";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, useCreatePost } from "../api";
import { clearDraft, readDraft, writeDraft } from "../draft";
import { SUGGESTED_TAGS, type TradeCard } from "../types";
import { TradeCardView } from "./trade-card-view";
import { SignInGate } from "./sign-in-gate";

interface ComposerProps {
  tradeCard?: TradeCard | null;
  onPosted?: (id: string) => void;
  /** localStorage key — when set, title/body/tags survive reloads until posted. */
  draftKey?: string;
  /** Focus the body textarea on mount (used by the inline feed composer). */
  autoFocusBody?: boolean;
}

/** Post composer — text, topic tags, images (auto-compressed), optional trade card. */
export function Composer({
  tradeCard: initialCard,
  onPosted,
  draftKey,
  autoFocusBody,
}: ComposerProps) {
  const createPost = useCreatePost();
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [tags, setTags] = React.useState<string[]>([]);
  const [images, setImages] = React.useState<string[]>([]);
  const [includePnl, setIncludePnl] = React.useState(false);
  const [gateOpen, setGateOpen] = React.useState(false);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  // Drafts restore after hydration (localStorage doesn't exist server-side, and
  // reading it during render would mismatch the server HTML).
  const [draftReady, setDraftReady] = React.useState(false);

  React.useEffect(() => {
    if (draftKey) {
      const draft = readDraft(draftKey);
      if (draft) {
        setTitle(draft.title);
        setBody(draft.body);
        setTags(draft.tags);
      }
    }
    setDraftReady(true);
  }, [draftKey]);

  React.useEffect(() => {
    if (!draftKey || !draftReady) return;
    writeDraft({ title, body, tags }, draftKey); // empty drafts remove the key
  }, [draftKey, draftReady, title, body, tags]);

  React.useEffect(() => {
    if (!autoFocusBody || !draftReady) return;
    const el = bodyRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length); // cursor after restored draft
    }
  }, [autoFocusBody, draftReady]);

  const card: TradeCard | null = initialCard
    ? { ...initialCard, netPnl: includePnl ? initialCard.netPnl : null }
    : null;

  const toggleTag = (t: string) =>
    setTags((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : prev.length < 4 ? [...prev, t] : prev
    );

  const addImage = async (file: File) => {
    if (images.length >= 2) return toast.info("Maximum 2 images per post");
    try {
      setImages((prev) => [...prev, ""].slice(0, 2)); // placeholder while compressing
      const data = await compressImage(file);
      setImages((prev) => prev.map((p) => (p === "" ? data : p)));
    } catch {
      setImages((prev) => prev.filter((p) => p !== ""));
      toast.error("Could not process that image");
    }
  };

  // Attempt the post directly; the server checks auth via cookie. Only fall back to
  // the sign-in gate on a real 401 — no client-side session pre-check (avoids stale
  // session state, and signed-in users post in one click).
  const submit = async () => {
    try {
      const { id } = await createPost.mutateAsync({
        title: title.trim() || undefined,
        body: body.trim(),
        tags,
        tradeCard: card,
        images: images.filter(Boolean),
      });
      toast.success("Posted to the community");
      setTitle("");
      setBody("");
      setTags([]);
      setImages([]);
      if (draftKey) clearDraft(draftKey);
      onPosted?.(id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setGateOpen(true); // gate's onAuthed retries submit() — cookie is set by then
        return;
      }
      toast.error(e instanceof Error ? e.message : "Could not post");
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="composer-title">Title (optional)</Label>
        <Input
          id="composer-title"
          maxLength={120}
          placeholder="e.g. BANKNIFTY expiry scalp — what I learned"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="composer-body">Your post</Label>
        <Textarea
          id="composer-body"
          ref={bodyRef}
          rows={5}
          maxLength={5000}
          placeholder="Share the idea, the lesson, the question…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onPaste={(e) => {
            const file = Array.from(e.clipboardData.items)
              .find((i) => i.type.startsWith("image/"))
              ?.getAsFile();
            if (file) void addImage(file);
          }}
        />
      </div>

      {card && (
        <div>
          <TradeCardView card={card} />
          {initialCard?.netPnl != null && (
            <div className="mt-2 flex items-center justify-between rounded-lg border bg-surface-2/40 px-3 py-2">
              <Label htmlFor="composer-pnl" className="text-xs">
                Include ₹ P&L on the card
              </Label>
              <Switch id="composer-pnl" checked={includePnl} onCheckedChange={setIncludePnl} />
            </div>
          )}
        </div>
      )}

      <fieldset>
        <legend className="micro-label mb-1.5">Topics (up to 4)</legend>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED_TAGS.map((t) => (
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

      {images.filter(Boolean).length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {images.filter(Boolean).map((src, i) => (
            <div key={i} className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`Attachment ${i + 1}`} className="w-full rounded-lg border" />
              <button
                aria-label={`Remove image ${i + 1}`}
                onClick={() => setImages((prev) => prev.filter((p) => p !== src))}
                className="absolute right-1.5 top-1.5 rounded-md bg-black/70 p-1 text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <label className="cursor-pointer">
          <span className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs text-muted hover:bg-surface-2 hover:text-foreground">
            <ImagePlus className="h-4 w-4" aria-hidden /> Add chart image
          </span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            aria-label="Attach an image"
            onChange={(e) => e.target.files?.[0] && void addImage(e.target.files[0])}
          />
        </label>
        <Button
          className="ml-auto"
          onClick={submit}
          disabled={createPost.isPending || body.trim().length < 2}
          aria-busy={createPost.isPending}
        >
          {createPost.isPending && <Loader2 className="animate-spin" aria-hidden />}
          Post
        </Button>
      </div>

      <p className="text-[11px] leading-4 text-muted">
        Educational discussion only — nothing on TradeMarkk is investment advice. Be kind; no tips,
        no spam, no paid-group promotion.
      </p>

      <SignInGate open={gateOpen} onOpenChange={setGateOpen} onAuthed={submit} />
    </div>
  );
}
