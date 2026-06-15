"use client";

import * as React from "react";
import { X, Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { VariantTwoTier } from "@/features/trades/components/add-trade-lab/variant-two-tier";
import { VariantCalmZones } from "@/features/trades/components/add-trade-lab/variant-calm-zones";
import { VariantBrokerTicket } from "@/features/trades/components/add-trade-lab/variant-broker-ticket";

type VariantKey = "two-tier" | "calm" | "broker";

const VARIANTS: { key: VariantKey; name: string; blurb: string }[] = [
  {
    key: "two-tier",
    name: "Two-Tier Ticket",
    blurb:
      "Box-free Essentials spine + one always-open ‘Plan & journal’ well + pinned footer. Recommended — fastest path, nothing hidden.",
  },
  {
    key: "calm",
    name: "Calm Zones",
    blurb:
      "Five explicitly-labeled section cards (Instrument · Position · Risk · Journal · Timing) + pinned footer.",
  },
  {
    key: "broker",
    name: "Adaptive Broker Ticket",
    blurb:
      "Form on the left, a persistent summary rail on the right (desktop). Single column + footer on mobile.",
  },
];

export default function AddTradeLabPage() {
  const [variant, setVariant] = React.useState<VariantKey>("two-tier");
  const [mobile, setMobile] = React.useState(false);
  const active = VARIANTS.find((v) => v.key === variant)!;

  const touch = mobile;
  const frameWidth = mobile ? 390 : variant === "broker" ? 680 : 520;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Add-trade modal — design lab</h1>
        <p className="mt-1 text-sm text-muted">
          Local only (not deployed). Compare the three redesign directions, then tell me which to
          ship. Each is fully wired to the local DB — you can actually type, switch segments, add
          legs, and Save.
        </p>
      </div>

      {/* Variant switcher */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg border bg-surface p-1">
          {VARIANTS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setVariant(v.key)}
              aria-pressed={variant === v.key}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                variant === v.key
                  ? "bg-surface-2 text-foreground shadow-sm"
                  : "text-muted hover:text-foreground"
              )}
            >
              {v.name}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1 rounded-lg border bg-surface p-1">
          <button
            type="button"
            onClick={() => setMobile(false)}
            aria-pressed={!mobile}
            title="Desktop dialog"
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              !mobile
                ? "bg-surface-2 text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            )}
          >
            <Monitor className="h-4 w-4" /> Desktop
          </button>
          <button
            type="button"
            onClick={() => setMobile(true)}
            aria-pressed={mobile}
            title="Mobile sheet"
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              mobile ? "bg-surface-2 text-foreground shadow-sm" : "text-muted hover:text-foreground"
            )}
          >
            <Smartphone className="h-4 w-4" /> Mobile
          </button>
        </div>
      </div>

      <p className="max-w-2xl text-sm text-muted">{active.blurb}</p>

      {/* Modal frame */}
      <div className="flex justify-center rounded-xl border border-dashed bg-surface-2/30 p-6">
        <div
          className="flex max-w-full flex-col overflow-hidden rounded-xl border bg-bg shadow-xl"
          style={{ width: frameWidth, height: 660 }}
        >
          <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
            <span className="text-base font-semibold">Add trade</span>
            <X className="h-4 w-4 text-muted" aria-hidden />
          </div>
          <div className="min-h-0 flex-1">
            {variant === "two-tier" && <VariantTwoTier key={`tt-${touch}`} touch={touch} />}
            {variant === "calm" && <VariantCalmZones key={`cz-${touch}`} touch={touch} />}
            {variant === "broker" && <VariantBrokerTicket key={`bt-${touch}`} touch={touch} />}
          </div>
        </div>
      </div>
    </div>
  );
}
