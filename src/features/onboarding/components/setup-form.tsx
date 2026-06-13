"use client";

import * as React from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  CalendarRange,
  Coins,
  IndianRupee,
  Layers,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useDb } from "@/providers/db-session-provider";
import { seedDefaults, seedSampleData } from "@/lib/db/seed";
import { BROKERS } from "@/config/brokers";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEFAULT_TRADER_TYPE, type TraderType } from "../trader-profile";

/** The trader-type cards shown in onboarding (lucide icons, no emoji). */
const TRADER_TYPE_CARDS: {
  type: TraderType;
  label: string;
  hint: string;
  icon: LucideIcon;
}[] = [
  {
    type: "intraday-equity",
    label: "Intraday equity",
    hint: "Stocks, squared off same day",
    icon: Activity,
  },
  {
    type: "swing",
    label: "Swing & positional",
    hint: "Delivery, held days to weeks",
    icon: CalendarRange,
  },
  {
    type: "fno",
    label: "F&O",
    hint: "Options & futures",
    icon: Layers,
  },
  {
    type: "commodity",
    label: "Commodity",
    hint: "MCX / NCDEX",
    icon: Coins,
  },
  {
    type: "currency",
    label: "Currency",
    hint: "USDINR & other pairs",
    icon: IndianRupee,
  },
  {
    type: "mixed",
    label: "A bit of everything",
    hint: "Mixed — set defaults per trade",
    icon: Sparkles,
  },
];

/** First-run setup: trader type, account, broker (charges profile), capital, risk. */
export function SetupForm({ onDone }: { onDone: () => void }) {
  const { db } = useDb();
  const qc = useQueryClient();
  const [broker, setBroker] = React.useState("zerodha");
  // Trader type defaults to "mixed" — onboarding is optional/skippable. The pick
  // sets the trade-form default segment/product, biases the dashboard, and
  // tailors the sample data.
  const [traderType, setTraderType] = React.useState<TraderType>(DEFAULT_TRADER_TYPE);
  const [busy, setBusy] = React.useState<"setup" | "sample" | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy("setup");
    try {
      await seedDefaults(db, {
        accountName: String(form.get("name") || "My Account"),
        broker,
        startingCapital: Number(form.get("capital") || 0),
        defaultRiskPct: Number(form.get("risk") || 1),
        traderType,
      });
      await qc.invalidateQueries();
      toast.success("You're all set — happy journaling!");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setBusy(null);
    }
  };

  // Populates the journal with ~3 months of realistic demo trades, rule checks,
  // journals and tags MATCHING the chosen trader type — so a first-time visitor
  // can explore every screen (insights, analytics, discipline) with relevant
  // data instead of an empty shell. A swing pick seeds multi-day CNC equity, an
  // F&O pick seeds multi-leg option strategies, commodity seeds MCX futures, etc.
  const loadSample = async () => {
    setBusy("sample");
    try {
      await seedSampleData(db, traderType);
      await qc.invalidateQueries();
      toast.success("Sample journal loaded — explore away!");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load sample data");
    } finally {
      setBusy(null);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">What do you trade most?</legend>
        <p className="text-xs text-muted">Sets your defaults — change any of it per trade.</p>
        <div className="grid grid-cols-2 gap-2 pt-1">
          {TRADER_TYPE_CARDS.map((card) => {
            const active = traderType === card.type;
            return (
              <button
                key={card.type}
                type="button"
                aria-pressed={active}
                onClick={() => setTraderType(card.type)}
                className={cn(
                  "flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all",
                  active
                    ? "border-accent bg-accent/10 shadow-sm shadow-accent/5"
                    : "bg-surface hover:border-accent/50 hover:bg-surface-2"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                    active ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted"
                  )}
                >
                  <card.icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold leading-tight">{card.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-tight text-muted">
                    {card.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="space-y-1">
        <Label>Account name</Label>
        <Input name="name" placeholder="My trading account" defaultValue="My Account" />
      </div>
      <div className="space-y-1">
        <Label>Broker (sets the charges calculator)</Label>
        <Select value={broker} onValueChange={setBroker}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BROKERS.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label>Starting capital ₹</Label>
          <Input name="capital" type="number" placeholder="500000" defaultValue={500000} />
        </div>
        <div className="space-y-1">
          <Label>Risk per trade %</Label>
          <Input name="risk" type="number" step="0.1" placeholder="1" defaultValue={1} />
        </div>
      </div>
      <p className="text-xs text-muted">
        We&apos;ll also add starter rules, mistake tags and playbooks — edit them anytime.
      </p>
      <Button type="submit" className="w-full" disabled={busy !== null}>
        {busy === "setup" ? "Setting up…" : "Start journaling"}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={loadSample}
        disabled={busy !== null}
      >
        {busy === "sample" ? "Loading sample data…" : "Explore with sample data"}
      </Button>
    </form>
  );
}
