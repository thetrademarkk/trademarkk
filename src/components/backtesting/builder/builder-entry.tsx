"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useBuilderStore } from "@/features/backtest/builder/builder-store";
import { TEMPLATES_BY_ID } from "@/features/backtest/builder/templates";
import { BuilderShell } from "./builder-shell";

/**
 * Client entry for /backtesting/build. Applies a `?template=<id>` deep link
 * ONCE on mount (prefill legs from a template), then renders the persistent
 * builder shell. The store is already hydrated from localStorage by the time
 * this runs, so an existing draft is preserved unless a template is requested.
 */
export function BuilderEntry() {
  const params = useSearchParams();
  const applyTemplate = useBuilderStore((s) => s.applyTemplate);
  const setStep = useBuilderStore((s) => s.setStep);
  const applied = React.useRef(false);

  React.useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    const templateId = params.get("template");
    if (templateId && TEMPLATES_BY_ID[templateId]) {
      applyTemplate(templateId);
      setStep("legs");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <BuilderShell />;
}
