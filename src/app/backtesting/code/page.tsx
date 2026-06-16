import type { Metadata } from "next";
import { ByocStudio } from "@/components/backtesting/byoc/byoc-studio";

export const metadata: Metadata = {
  title: "Bring your own code",
  description:
    "Write a JavaScript strategy and run it entirely in your browser, in a sandboxed VM, against real 1-minute market data — zero server trust, zero cost.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/backtesting/code" },
};

/**
 * Bring-your-own-code studio. A user writes a plain-JS `strategy(bars, ta)` that
 * runs in a QuickJS-WASM sandbox (no host access) against the real HF 1-minute
 * series loaded via duckdb-wasm — JS-only, free, and safe. See ByocStudio.
 */
export default function BacktestingCodePage() {
  return <ByocStudio />;
}
