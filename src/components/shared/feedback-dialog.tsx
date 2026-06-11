"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Bug, Lightbulb, Loader2, MessageCircle, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { id: "idea", label: "Idea", icon: Lightbulb },
  { id: "bug", label: "Bug", icon: Bug },
  { id: "other", label: "Other", icon: MessageCircle },
] as const;

/** Product feedback dialog — anonymous-friendly, works on every surface. */
export function FeedbackDialog({ trigger }: { trigger?: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [open, setOpen] = React.useState(false);
  const [category, setCategory] = React.useState<(typeof CATEGORIES)[number]["id"]>("idea");
  const [message, setMessage] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [anonymous, setAnonymous] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const knownEmail = session?.user.email ?? null;

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          message: message.trim(),
          email: anonymous ? "" : email.trim(),
          path: pathname,
          anonymous,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not send feedback");
      toast.success("Thank you! Feedback received.");
      setMessage("");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send feedback");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <span onClick={() => setOpen(true)}>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden /> Feedback
          </Button>
        )}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Send feedback</DialogTitle>
            <DialogDescription>Ideas and bug reports shape the roadmap directly.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2" role="radiogroup" aria-label="Feedback type">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  role="radio"
                  aria-checked={category === c.id}
                  onClick={() => setCategory(c.id)}
                  className={cn(
                    "flex-1 rounded-lg border px-2 py-2 text-xs font-medium transition-colors",
                    category === c.id
                      ? "border-accent bg-accent/15 text-accent"
                      : "text-muted hover:bg-surface-2"
                  )}
                >
                  <c.icon className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                  {c.label}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fb-message">What&apos;s on your mind?</Label>
              <Textarea
                id="fb-message"
                rows={4}
                maxLength={2000}
                placeholder="The more specific, the better…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
            {/* Identity: known email shown (not re-asked); anonymous strips it entirely. */}
            <div className="flex items-center justify-between rounded-lg border bg-surface-2/40 px-3 py-2">
              <div className="min-w-0">
                <Label htmlFor="fb-anon" className="text-xs text-foreground">
                  Send anonymously
                </Label>
                {!anonymous && knownEmail && (
                  <p className="truncate text-xs text-muted">
                    We&apos;ll follow up at {knownEmail}
                  </p>
                )}
                {anonymous && (
                  <p className="text-xs text-muted">No name or email will be attached</p>
                )}
              </div>
              <Switch id="fb-anon" checked={anonymous} onCheckedChange={setAnonymous} />
            </div>
            {!anonymous && !knownEmail && (
              <div className="space-y-1.5">
                <Label htmlFor="fb-email">Email (optional — for follow-up)</Label>
                <Input
                  id="fb-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            )}
            <Button
              className="w-full"
              onClick={submit}
              disabled={busy || message.trim().length < 5}
              aria-busy={busy}
            >
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              Send feedback
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
