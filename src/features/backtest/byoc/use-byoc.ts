"use client";

/**
 * useByoc — the browser hook that wires the BYOC editor to real data + the QuickJS
 * sandbox. It loads the chosen underlying's spot series (resampled to the interval)
 * via the SAME duckdb-wasm HF client the no-code builder uses, then runs the user's
 * JavaScript in the sandbox and exposes a small status machine. Loading duck-browser
 * + quickjs-emscripten are both lazy (only on first run), so the page is light.
 */

import * as React from "react";
import { OptionsDataClient } from "@/lib/backtest/data/client";
import type { Interval, Sym } from "@/lib/backtest/data/schema";
import { runByoc } from "@/lib/backtest/byoc/sandbox";
import type { ByocBar, ByocResult } from "@/lib/backtest/byoc/types";

export type ByocStatus = "idle" | "loading-data" | "running" | "done" | "error";

export interface ByocRunParams {
  symbol: Sym;
  from: string;
  to: string;
  interval: Interval | string;
}

export function useByoc() {
  const [status, setStatus] = React.useState<ByocStatus>("idle");
  const [result, setResult] = React.useState<ByocResult | null>(null);
  const [error, setError] = React.useState("");
  const [barCount, setBarCount] = React.useState(0);
  const runId = React.useRef(0);

  const run = React.useCallback(async (code: string, params: ByocRunParams) => {
    const id = ++runId.current;
    setStatus("loading-data");
    setError("");
    setResult(null);
    setBarCount(0);
    try {
      const client = new OptionsDataClient();
      const idx = await client.loadIndex(
        params.symbol,
        params.from,
        params.to,
        params.interval as Interval
      );
      if (id !== runId.current) return; // superseded
      const bars: ByocBar[] = idx.map((x) => ({
        t: x.ts,
        o: x.open,
        h: x.high,
        l: x.low,
        c: x.close,
        v: x.volume,
      }));
      setBarCount(bars.length);
      if (bars.length === 0) {
        setStatus("error");
        setError("No market data in that window — try a denser/historical range.");
        return;
      }
      setStatus("running");
      const r = await runByoc(code, bars, { timeoutMs: 6000 });
      if (id !== runId.current) return;
      setResult(r);
      setStatus(r.ok ? "done" : "error");
      if (!r.ok) setError(r.error);
    } catch (e) {
      if (id !== runId.current) return;
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return { status, result, error, barCount, run };
}
