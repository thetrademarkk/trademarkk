"use client";

import * as React from "react";
import { Check, Link2, Loader2, Save, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SignInGate } from "@/features/community";
import { useSession } from "@/lib/auth-client";
import { holdRun, readHeldRun, clearHeldRun } from "@/features/backtest/persist/held-run";
import type { RunResult } from "@/features/backtest/shared/run-result";
import type { StrategyDef } from "@/features/backtest/shared/strategy-def";

/**
 * Save / Share bar — the ONE place login is nudged in the backtesting universe.
 *
 * Building + running stay fully anonymous (no gate anywhere). This bar appears
 * only once a run is DONE. When a signed-out user clicks Save or Share:
 *   1. we HOLD the run (its immutable RunResult + the StrategyDef) in IndexedDB —
 *      never re-running the engine;
 *   2. we raise the existing SignInGate dialog (the app's auth-nudge idiom);
 *   3. on auth, a one-shot effect reads the held run and POSTs it ONCE to claim
 *      ownership, then clears the local copy.
 * A signed-in user skips straight to the save/share network call.
 *
 * Share is opt-in + idempotent: the first Share mints an unguessable link;
 * re-sharing the same run returns the SAME url. A shared run is read-only for
 * everyone, owner included (immutable artifact) — there is no edit affordance.
 */
type PendingAction = "save" | "share" | null;

export function SaveShareBar({ result, strategy }: { result: RunResult; strategy: StrategyDef }) {
  const { data: session, isPending } = useSession();
  const signedIn = Boolean(session?.user);

  const [gateOpen, setGateOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<PendingAction>(null);
  const [savedRunId, setSavedRunId] = React.useState<string | null>(null);
  const [shareUrl, setShareUrl] = React.useState<string | null>(null);
  // What to do once the SignInGate completes (the intent the user clicked).
  const pendingRef = React.useRef<PendingAction>(null);
  // Guard the one-shot claim so a re-render can't double-POST.
  const claimedRef = React.useRef(false);

  /** POST the immutable run to claim/save it. Returns the new runId or null. */
  const persistRun = React.useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/backtest/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ strategy, result }),
      });
      if (res.status === 401) return null; // not signed in — caller raises the gate
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      const json = (await res.json()) as { runId: string };
      return json.runId;
    } catch {
      toast.error("Could not save the backtest — try again");
      return null;
    }
  }, [strategy, result]);

  /** Ensure the run is saved; returns its id (saving once, then memoised). */
  const ensureSaved = React.useCallback(async (): Promise<string | null> => {
    if (savedRunId) return savedRunId;
    const id = await persistRun();
    if (id) setSavedRunId(id);
    return id;
  }, [savedRunId, persistRun]);

  const doSave = React.useCallback(async () => {
    setBusy("save");
    const id = await ensureSaved();
    setBusy(null);
    if (id) toast.success("Backtest saved to your account");
  }, [ensureSaved]);

  const doShare = React.useCallback(async () => {
    setBusy("share");
    try {
      const id = await ensureSaved();
      if (!id) return; // save failed / gate will handle the unauthenticated case
      const res = await fetch(`/api/backtest/runs/${id}/share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      if (!res.ok) throw new Error(`share failed (${res.status})`);
      const json = (await res.json()) as { url: string | null };
      if (json.url) {
        setShareUrl(json.url);
        try {
          await navigator.clipboard.writeText(json.url);
          toast.success("Public link copied to clipboard");
        } catch {
          toast.success("Public link created");
        }
      }
    } catch {
      toast.error("Could not create a share link — try again");
    } finally {
      setBusy(null);
    }
  }, [ensureSaved]);

  /** Intent click: signed-in → act now; signed-out → hold the run + raise gate. */
  const onIntent = (action: "save" | "share") => {
    if (signedIn) {
      void (action === "save" ? doSave() : doShare());
      return;
    }
    pendingRef.current = action;
    // Persist the immutable artifact so it survives the auth navigation/dialog.
    void holdRun(strategy, result);
    setGateOpen(true);
  };

  // One-shot claim: after auth, read the held run and persist it ONCE, then
  // resume the action the user originally intended (save → toast; share → link).
  React.useEffect(() => {
    if (!signedIn || claimedRef.current) return;
    let cancelled = false;
    (async () => {
      const held = await readHeldRun();
      if (cancelled) return;
      if (!held && pendingRef.current === null) return; // nothing to claim
      claimedRef.current = true;
      const intent = pendingRef.current;
      pendingRef.current = null;
      // Claim the held run (or the in-memory current run) — never re-run.
      const id = await ensureSaved();
      await clearHeldRun();
      if (cancelled || !id) return;
      if (intent === "share") void doShare();
      else if (intent === "save") toast.success("Backtest saved to your account");
    })();
    return () => {
      cancelled = true;
    };
    // ensureSaved/doShare are stable enough; we only want this to fire on auth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  const working = busy !== null;

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-xl border bg-surface/60 p-3"
      data-testid="bt-save-share-bar"
    >
      <span className="mr-1 text-sm font-medium">Keep this run</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onIntent("save")}
        disabled={working || isPending}
        data-testid="bt-save"
      >
        {busy === "save" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : savedRunId ? (
          <Check className="h-3.5 w-3.5 text-profit" aria-hidden />
        ) : (
          <Save className="h-3.5 w-3.5" aria-hidden />
        )}
        {savedRunId ? "Saved" : "Save"}
      </Button>

      <Button
        type="button"
        size="sm"
        onClick={() => onIntent("share")}
        disabled={working || isPending}
        data-testid="bt-share"
      >
        {busy === "share" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Share2 className="h-3.5 w-3.5" aria-hidden />
        )}
        Share
      </Button>

      {shareUrl && (
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              .writeText(shareUrl)
              .then(() => toast.success("Public link copied"));
          }}
          className="inline-flex max-w-full items-center gap-1 truncate rounded-md border bg-surface px-2 py-1 text-xs text-accent hover:underline"
          data-testid="bt-share-url"
          aria-label="Copy public share link"
        >
          <Link2 className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{shareUrl.replace(/^https?:\/\//, "")}</span>
        </button>
      )}

      {!signedIn && (
        <span className="basis-full text-xs text-muted">
          Building and running are free and anonymous — sign in only to save or share a link.
        </span>
      )}

      <SignInGate
        open={gateOpen}
        onOpenChange={setGateOpen}
        // The one-shot claim effect resumes the pending action once signed in.
      />
    </div>
  );
}
