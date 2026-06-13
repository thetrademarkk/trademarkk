"use client";

import * as React from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useDb } from "@/providers/db-session-provider";
import { seedDefaults, seedSampleData } from "@/lib/db/seed";
import { BROKERS } from "@/config/brokers";
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

/** First-run setup: account, broker (charges profile), capital, risk. Seeds defaults. */
export function SetupForm({ onDone }: { onDone: () => void }) {
  const { db } = useDb();
  const qc = useQueryClient();
  const [broker, setBroker] = React.useState("zerodha");
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
  // journals and tags — so a first-time visitor can explore every screen
  // (insights, analytics, discipline) with data instead of an empty shell.
  const loadSample = async () => {
    setBusy("sample");
    try {
      await seedSampleData(db);
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
