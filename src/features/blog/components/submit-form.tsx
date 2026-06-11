"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { SignInGate } from "@/features/community";
import { submitBlogSchema } from "../schemas";

// Heavy editor (TipTap + ProseMirror) — load only on this page, client-only.
const RichEditor = dynamic(() => import("@/components/ui/rich-editor").then((m) => m.RichEditor), {
  ssr: false,
  loading: () => <Skeleton className="h-64 rounded-lg" />,
});

export function BlogSubmitForm() {
  const [title, setTitle] = React.useState("");
  const [excerpt, setExcerpt] = React.useState("");
  const [content, setContent] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [gateOpen, setGateOpen] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const submit = async () => {
    setError(null);
    const parsed = submitBlogSchema.safeParse({ title, excerpt, contentHtml: content });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please complete the form");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/blog/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (res.status === 401) {
        setGateOpen(true);
        return;
      }
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Submission failed");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border bg-surface p-8 text-center">
        <CheckCircle2 className="h-10 w-10 text-profit" aria-hidden />
        <h2 className="text-lg font-semibold">Submitted for review</h2>
        <p className="max-w-sm text-sm text-muted">
          Thanks for contributing! Our team will review your post and publish it if it&apos;s a good
          fit. You&apos;ll see it on the blog once approved.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="blog-title">Title</Label>
        <Input
          id="blog-title"
          maxLength={120}
          placeholder="What I learned losing ₹50k on expiry day"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="blog-excerpt">Summary</Label>
        <Textarea
          id="blog-excerpt"
          rows={2}
          maxLength={280}
          placeholder="One or two sentences shown in the blog list and search results."
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Article</Label>
        <RichEditor
          value={content}
          onChange={setContent}
          placeholder="Write your article…"
          minHeight={280}
        />
      </div>

      {error && (
        <p className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          Posts are reviewed before publishing. Educational content only.
        </p>
        <Button onClick={submit} disabled={busy} aria-busy={busy}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          Submit for review
        </Button>
      </div>

      <SignInGate open={gateOpen} onOpenChange={setGateOpen} onAuthed={submit} />
    </div>
  );
}
