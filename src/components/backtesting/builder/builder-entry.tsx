"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useBuilderStore } from "@/features/backtest/builder/builder-store";
import { TEMPLATES_BY_ID } from "@/features/backtest/builder/templates";
import { presetById } from "@/features/backtest/presets/catalogue";
import { BuilderShell } from "./builder-shell";

/**
 * Client entry for /backtesting/build. Applies a deep link ONCE on mount:
 *  - `?preset=<id>` — hydrate the FULL preset StrategyDef (legs + timing + risk +
 *    market) into the wizard verbatim via `loadDraft`, then jump to Review. With
 *    `&run=1` (from a preset card's "Run") it also requests an auto-run.
 *  - `?template=<id>` — the lighter, legs-only template prefill (BT-06).
 * The store is already hydrated from localStorage by the time this runs, so an
 * existing draft is preserved unless a preset/template is requested.
 */
export function BuilderEntry() {
  const params = useSearchParams();
  const applyTemplate = useBuilderStore((s) => s.applyTemplate);
  const loadDraft = useBuilderStore((s) => s.loadDraft);
  const setStep = useBuilderStore((s) => s.setStep);
  const applied = React.useRef(false);
  const [autoRun, setAutoRun] = React.useState(false);

  React.useEffect(() => {
    if (applied.current) return;
    applied.current = true;

    const presetId = params.get("preset");
    if (presetId) {
      const preset = presetById(presetId);
      if (preset) {
        loadDraft(preset.build());
        const wantRun = params.get("run") === "1";
        setStep(wantRun ? "review" : "legs");
        if (wantRun) setAutoRun(true);
        return;
      }
    }

    const templateId = params.get("template");
    if (templateId && TEMPLATES_BY_ID[templateId]) {
      applyTemplate(templateId);
      setStep("legs");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <BuilderShell autoRun={autoRun} onAutoRunConsumed={() => setAutoRun(false)} />;
}
