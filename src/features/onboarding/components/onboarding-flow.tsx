"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  CandlestickChart,
  Check,
  Cloud,
  Database,
  PlayCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useDbSession } from "@/providers/db-session-provider";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/shared/logo";
import { AuthForm } from "@/features/auth";
import { ByodWizard } from "./byod-wizard";
import { SetupForm } from "./setup-form";

type Step = "choose" | "hosted" | "byod" | "setup";

const BRAND_POINTS = [
  "Log FnO trades in 15 seconds — charges auto-calculated",
  "Daily rules checklist with the ₹ cost of breaking them",
  "Your data in your own database, if you want it",
];

const MODE_CARDS = [
  {
    key: "hosted" as const,
    icon: Cloud,
    title: "Start free — we host it",
    text: "Sign up in a minute. Your own isolated database, hosted by us.",
    badge: "Recommended",
  },
  {
    key: "byod" as const,
    icon: Database,
    title: "Bring your own database",
    text: "Maximum privacy — we never see your data. Free Turso DB, 3-min setup.",
    badge: "Private",
  },
  {
    key: "demo" as const,
    icon: PlayCircle,
    title: "Try without an account",
    text: "Instant and private — a real SQLite journal inside your browser.",
    badge: "Instant",
  },
];

/** Orchestrates: choose mode → connect → first-run setup → dashboard. */
export function OnboardingFlow() {
  const router = useRouter();
  const { state, connectHosted, startLocal } = useDbSession();
  const { data: session } = useSession();
  const [step, setStep] = React.useState<Step>("choose");
  const [busy, setBusy] = React.useState<string | null>(null);

  const goDashboard = React.useCallback(() => router.replace("/app/dashboard"), [router]);

  // Returning signed-in users with a provisioned DB skip the mode picker entirely.
  const [autoConnecting, setAutoConnecting] = React.useState(true);
  React.useEffect(() => {
    if (state.status !== "none") {
      setAutoConnecting(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (!session) return;
        const res = await fetch("/api/db/status");
        const data = (await res.json()) as { provisioned?: boolean };
        if (!cancelled && data.provisioned) {
          await connectHosted();
          return;
        }
      } catch {
        /* fall through to manual picker */
      } finally {
        if (!cancelled) setAutoConnecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, state.status, connectHosted]);

  // Once a DB is connected, decide: already onboarded → dashboard, else setup.
  React.useEffect(() => {
    if (state.status !== "ready") return;
    let cancelled = false;
    void state.db.execute(`SELECT value FROM settings WHERE key = 'onboarded'`).then((res) => {
      if (cancelled) return;
      if (res.rows.length > 0) goDashboard();
      else setStep("setup");
    });
    return () => {
      cancelled = true;
    };
  }, [state, goDashboard]);

  const handleHostedContinue = async () => {
    setBusy("hosted");
    try {
      await connectHosted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not connect hosted storage");
    } finally {
      setBusy(null);
    }
  };

  const handleDemo = React.useCallback(async () => {
    setBusy("demo");
    try {
      // Starts empty — the ready-state effect routes new journals through setup.
      await startLocal();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Demo failed to start");
      setBusy(null);
    }
  }, [startLocal]);

  // Landing-page "Try the live demo" deep link: /app/onboarding?mode=demo
  // starts the in-browser journal immediately (new visitors only — anyone
  // with a session or an existing journal keeps the normal flow).
  const wantDemo = useSearchParams().get("mode") === "demo";
  const demoStarted = React.useRef(false);
  React.useEffect(() => {
    if (!wantDemo || demoStarted.current || session || state.status !== "none") return;
    demoStarted.current = true;
    void handleDemo();
  }, [wantDemo, session, state.status, handleDemo]);

  const pick = (key: (typeof MODE_CARDS)[number]["key"]) => {
    if (key === "demo") void handleDemo();
    else setStep(key);
  };

  // While we check a returning user's session, show a quiet connecting state
  // instead of flashing the full mode picker.
  if (autoConnecting && session && step === "choose") {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="flex items-center gap-2 text-muted">
          <CandlestickChart className="h-5 w-5 animate-pulse text-accent" aria-hidden />
          <span className="text-sm">Welcome back — opening your journal…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      {/* ── Brand panel (desktop) ── */}
      <div className="relative hidden overflow-hidden border-r lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div className="hero-glow absolute inset-0" aria-hidden />
        <Logo className="relative" />
        <div className="relative">
          <h2 className="max-w-sm text-3xl font-bold leading-tight">
            Mark your trade, <span className="text-gradient">every day.</span>
          </h2>
          <ul className="mt-8 space-y-4">
            {BRAND_POINTS.map((p, i) => (
              <motion.li
                key={p}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.12 }}
                className="flex items-start gap-3 text-sm text-muted"
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-profit/15 text-profit">
                  <Check className="h-3 w-3" />
                </span>
                {p}
              </motion.li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-muted">
          Open source · MIT licensed · No paywall, ever.
        </p>
      </div>

      {/* ── Flow panel ── */}
      <div className="flex flex-col justify-center p-5 sm:p-10">
        <div className="mx-auto w-full max-w-md">
          <Logo className="mb-8 lg:hidden" />

          {step === "choose" && (
            <div className="space-y-3">
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <h1 className="text-2xl font-bold">Welcome</h1>
                <p className="mt-1 text-sm text-muted">How do you want to store your journal?</p>
              </motion.div>
              {MODE_CARDS.map((card, i) => (
                <motion.button
                  key={card.key}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.08 }}
                  onClick={() => pick(card.key)}
                  disabled={busy != null}
                  className="group flex w-full items-center gap-4 rounded-xl border bg-surface p-4 text-left transition-all hover:border-accent/60 hover:shadow-lg hover:shadow-accent/5 disabled:opacity-60"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent transition-transform group-hover:scale-110">
                    <card.icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold">
                        {busy === card.key ? "Setting things up…" : card.title}
                      </span>
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
                        {card.badge}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">{card.text}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-1 group-hover:text-accent" />
                </motion.button>
              ))}
            </div>
          )}

          {(step === "hosted" || step === "byod") && (
            <Button
              variant="ghost"
              size="sm"
              className="mb-4 -ml-2"
              onClick={() => setStep("choose")}
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          )}

          {step === "hosted" && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div>
                <h2 className="text-xl font-bold">Create your free account</h2>
                <p className="mt-1 text-sm text-muted">
                  You get a dedicated, isolated database — yours to export or take with you anytime.
                </p>
              </div>
              {session ? (
                <div className="space-y-2">
                  <p className="rounded-lg border bg-surface-2/50 px-3 py-2 text-sm">
                    Signed in as <span className="font-medium">{session.user.email}</span>
                  </p>
                  <Button className="w-full" onClick={handleHostedContinue} disabled={busy != null}>
                    {busy ? "Setting up your database…" : "Continue"}
                  </Button>
                </div>
              ) : (
                <AuthForm onAuthed={handleHostedContinue} />
              )}
            </motion.div>
          )}

          {step === "byod" && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div>
                <h2 className="text-xl font-bold">Connect your Turso database</h2>
                <p className="mt-1 text-sm text-muted">
                  We never see your data — promise, verifiable in the source.
                </p>
              </div>
              <ByodWizard onConnected={() => undefined /* effect handles next step */} />
            </motion.div>
          )}

          {step === "setup" && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div>
                <h2 className="text-xl font-bold">Set up your journal</h2>
                <p className="mt-1 text-sm text-muted">
                  30 seconds — you can change all of this later.
                </p>
              </div>
              <SetupForm onDone={goDashboard} />
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
