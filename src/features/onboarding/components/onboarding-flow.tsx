"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, Cloud, Database, Loader2, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { useDbSession } from "@/providers/db-session-provider";
import { getStoredMode } from "@/lib/db/byod-store";
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
  const { data: session, isPending: sessionLoading } = useSession();
  const [step, setStep] = React.useState<Step>("choose");
  const [busy, setBusy] = React.useState<string | null>(null);

  // A visitor with no previously chosen storage mode who lands here signed in is
  // a brand-new signup (e.g. just returned from Google) — greet them warmly at
  // the setup step. Returning users already have tm.mode persisted. The lazy
  // initializer is client-only (localStorage is undefined during prerender);
  // it runs once at mount so a mid-flow connectHosted() (which sets the mode)
  // can't flip it.
  const [isFreshArrival] = React.useState(
    () => typeof window !== "undefined" && getStoredMode() === null
  );

  const goDashboard = React.useCallback(() => router.replace("/app/dashboard"), [router]);

  // True once we've decided this visitor has a platform session and is heading
  // into hosted storage (returning user OR a fresh Google/email signup) — we
  // show a calm "setting up" state for them instead of ever flashing the picker.
  const [autoConnecting, setAutoConnecting] = React.useState(true);

  // Safety net: never strand a visitor on the loader if the session check hangs
  // (transient auth/network outage). After a few seconds we stop waiting and let
  // them through to the picker to choose a storage mode manually.
  const [sessionCheckTimedOut, setSessionCheckTimedOut] = React.useState(false);
  React.useEffect(() => {
    if (!sessionLoading) return;
    const t = setTimeout(() => setSessionCheckTimedOut(true), 7000);
    return () => clearTimeout(t);
  }, [sessionLoading]);

  React.useEffect(() => {
    if (state.status !== "none") {
      setAutoConnecting(false);
      return;
    }
    // The session cookie is still being read. A returning / just-returned-from-
    // Google user HAS a cookie, so we must wait for it to resolve before
    // deciding anything — flipping to the picker here is exactly what caused the
    // mode-picker to flash for a frame after Google sign-in. Keep the loader up
    // (unless the check has hung past our safety timeout).
    if (sessionLoading && !sessionCheckTimedOut) return;
    // Resolved with no platform session → genuine fresh visitor (or BYOD/demo/
    // local, which carry no session). Let them pick a storage mode.
    if (!session) {
      setAutoConnecting(false);
      return;
    }
    // Any signed-in user who isn't connected yet → provision-or-connect their
    // hosted DB and head straight to setup/dashboard. connectHosted() already
    // provisions a brand-new user's DB (token → 404 → provision → retry), so a
    // just-signed-up Google user never sees the mode picker again. We keep
    // autoConnecting=true throughout so the picker can't flash; the ready-state
    // effect below takes over once the DB is connected.
    let cancelled = false;
    (async () => {
      try {
        await connectHosted();
      } catch {
        // Provision genuinely failed (e.g. transient) — drop them onto the
        // picker so they can retry the hosted card manually rather than hang.
        if (!cancelled) setAutoConnecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, sessionLoading, sessionCheckTimedOut, state.status, connectHosted]);

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

  // Surface an OAuth error (e.g. Better Auth's ?error=account_not_linked) as a
  // friendly toast and strip it from the URL, rather than silently dropping the
  // user on the picker with a cryptic query string. Account linking is enabled
  // for Google so this should be rare, but it's a clean fallback.
  const searchParams = useSearchParams();
  const authErrorShown = React.useRef(false);
  React.useEffect(() => {
    const err = searchParams.get("error");
    if (!err || authErrorShown.current) return;
    authErrorShown.current = true;
    toast.error(
      err === "account_not_linked"
        ? "That email already has an account. Sign in with your password, then link Google from settings."
        : "Sign-in didn't complete. Please try again."
    );
    router.replace("/app/onboarding");
  }, [searchParams, router]);

  // Landing-page "Try the live demo" deep link: /app/onboarding?mode=demo
  // starts the in-browser journal immediately (new visitors only — anyone
  // with a session or an existing journal keeps the normal flow).
  const wantDemo = searchParams.get("mode") === "demo";
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

  // While we provision-or-connect a signed-in user's hosted DB, show a calm
  // full-screen "setting up" state instead of ever flashing the mode picker.
  // Brand-new signups (e.g. just returned from Google) see a welcome message;
  // returning users see "opening your journal".
  if (
    autoConnecting &&
    step === "choose" &&
    (session || (sessionLoading && !sessionCheckTimedOut))
  ) {
    // `known` = we've confirmed a signed-in user. While the session cookie is
    // still resolving we show neutral copy (could still turn out to be a fresh
    // visitor); once we know they're signed in we warm it up.
    const known = session != null;
    return (
      <div
        role="status"
        aria-live="polite"
        className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 text-center"
      >
        <div className="hero-glow absolute inset-0" aria-hidden />
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative flex flex-col items-center gap-4"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/12 text-accent">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          </span>
          <div className="space-y-1">
            <p className="text-base font-semibold">
              {!known
                ? "Just a moment…"
                : isFreshArrival
                  ? "Setting up your journal…"
                  : "Opening your journal…"}
            </p>
            <p className="text-sm text-muted">
              {!known
                ? "Signing you in securely."
                : isFreshArrival
                  ? "Creating your private, isolated database. This only takes a moment."
                  : "Welcome back — reconnecting your data."}
            </p>
          </div>
        </motion.div>
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
              {session ? (
                <>
                  <div>
                    <h2 className="text-xl font-bold">Finish setting up</h2>
                    <p className="mt-1 text-sm text-muted">
                      You&apos;re signed in — one tap to create your private, isolated database.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <p className="rounded-lg border bg-surface-2/50 px-3 py-2 text-sm">
                      Signed in as <span className="font-medium">{session.user.email}</span>
                    </p>
                    <Button
                      className="w-full"
                      onClick={handleHostedContinue}
                      disabled={busy != null}
                    >
                      {busy ? "Setting up your database…" : "Continue"}
                    </Button>
                  </div>
                </>
              ) : (
                // AuthForm renders its own mode-aware heading (sign up / in / reset).
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
                <h2 className="text-xl font-bold">
                  {isFreshArrival ? "You're in — set up your journal" : "Set up your journal"}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {isFreshArrival
                    ? "Last step: pick your broker and starting capital so charges and risk are spot-on. 30 seconds — change it all later."
                    : "30 seconds — you can change all of this later."}
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
