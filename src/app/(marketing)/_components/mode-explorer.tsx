"use client";

import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ArrowRight, Cloud, Database, HardDrive, MonitorSmartphone } from "lucide-react";
import { cn } from "@/lib/utils";

const MODES = [
  {
    id: "hosted",
    icon: Cloud,
    label: "Hosted",
    badge: "Default",
    target: "Your isolated database",
    targetSub: "provisioned just for you",
    text: "Sign up in a minute and start journaling. You get your own isolated database — not a row in someone else's. Export everything or move out anytime.",
  },
  {
    id: "byod",
    icon: Database,
    label: "Your database",
    badge: "Private",
    target: "Your own Turso DB",
    targetSub: "credentials never leave your browser",
    text: "Connect a free Turso database you own. Every query goes straight from your browser to your DB — we never see a single trade. Verifiable in the source.",
  },
  {
    id: "local",
    icon: HardDrive,
    label: "In-browser",
    badge: "Instant",
    target: "SQLite in this browser",
    targetSub: "no account, no upload",
    text: "A real SQLite database running inside your browser. Try the entire app in seconds — then move your data to hosted or your own DB whenever you're ready.",
  },
] as const;

/** Interactive storage-mode explorer: segmented control + animated flow diagram. */
export function ModeExplorer() {
  const [active, setActive] = React.useState<(typeof MODES)[number]["id"]>("hosted");
  const reduced = useReducedMotion();
  const mode = MODES.find((m) => m.id === active)!;

  return (
    <div className="mx-auto max-w-3xl">
      <div
        role="tablist"
        aria-label="Storage modes"
        className="mx-auto flex w-fit rounded-xl border bg-surface p-1"
      >
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={active === m.id}
            aria-label={m.label}
            onClick={() => setActive(m.id)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              active === m.id ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground"
            )}
          >
            <m.icon className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">{m.label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={mode.id}
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? undefined : { opacity: 0, y: -10 }}
          transition={{ duration: 0.25 }}
          className="mt-8"
        >
          {/* Flow diagram — text + arrows, deliberately not a card grid. */}
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-6">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl border bg-surface">
                <MonitorSmartphone className="h-5 w-5 text-muted" aria-hidden />
              </span>
              <div className="text-left">
                <p className="text-sm font-semibold">Your browser</p>
                <p className="text-xs text-muted">where the app runs</p>
              </div>
            </div>

            <div className="flex items-center gap-1 text-accent" aria-hidden>
              <span className="hidden h-px w-10 bg-gradient-to-r from-transparent to-accent sm:block" />
              <ArrowRight className="h-5 w-5 rotate-90 sm:rotate-0" />
              <span className="hidden h-px w-10 bg-gradient-to-l from-transparent to-accent sm:block" />
            </div>

            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-accent/50 bg-accent/10">
                <mode.icon className="h-5 w-5 text-accent" aria-hidden />
              </span>
              <div className="text-left">
                <p className="text-sm font-semibold">{mode.target}</p>
                <p className="text-xs text-muted">{mode.targetSub}</p>
              </div>
            </div>
          </div>

          <p className="mx-auto mt-6 max-w-xl text-center text-sm leading-7 text-muted">
            {mode.text}
          </p>
        </motion.div>
      </AnimatePresence>

      <p className="mt-6 text-center text-xs text-muted">
        Switch between all three anytime — copied in your browser, verified table-by-table.
      </p>
    </div>
  );
}
