"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { runSimulation, type SimInput, type SimResult } from "@/lib/montecarlo/simulate";
import type { WorkerRequest, WorkerResponse } from "@/lib/montecarlo/montecarlo.worker";

export type SimStatus = "idle" | "running" | "done" | "error";

export interface UseMonteCarlo {
  status: SimStatus;
  result: SimResult | null;
  error: string | null;
  /** Kick off a simulation; cancels any in-flight run. */
  run: (input: SimInput) => void;
}

/**
 * Drives the Monte-Carlo worker. Each `run` bumps a request id so a stale
 * worker reply (from a superseded run) is ignored. If the browser can't build
 * a Worker (very old engines, or a non-DOM test env) we fall back to running
 * the pure simulation synchronously — slower, but never breaks the feature.
 */
export function useMonteCarlo(): UseMonteCarlo {
  const [status, setStatus] = useState<SimStatus>("idle");
  const [result, setResult] = useState<SimResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);

  // Lazily build the worker once on the client; tear it down on unmount.
  const ensureWorker = useCallback((): Worker | null => {
    if (workerRef.current) return workerRef.current;
    if (typeof window === "undefined" || typeof Worker === "undefined") return null;
    try {
      // new URL(..., import.meta.url) is the pattern Next/Turbopack/webpack all
      // recognise to bundle the worker as its own fingerprinted chunk.
      const worker = new Worker(new URL("@/lib/montecarlo/montecarlo.worker", import.meta.url), {
        type: "module",
      });
      worker.addEventListener("message", (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        if (msg.id !== reqId.current) return; // stale reply from a superseded run
        if (msg.ok) {
          setResult(msg.result);
          setStatus("done");
        } else {
          setError(msg.error);
          setStatus("error");
        }
      });
      worker.addEventListener("error", (e) => {
        setError(e.message || "Simulation worker failed");
        setStatus("error");
      });
      workerRef.current = worker;
      return worker;
    } catch {
      return null; // fall back to synchronous mode in `run`
    }
  }, []);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const run = useCallback(
    (input: SimInput) => {
      const id = ++reqId.current;
      setStatus("running");
      setError(null);
      const worker = ensureWorker();
      if (worker) {
        const req: WorkerRequest = { id, input };
        worker.postMessage(req);
        return;
      }
      // Synchronous fallback — defer a tick so the spinner can paint first.
      setTimeout(() => {
        if (id !== reqId.current) return;
        try {
          setResult(runSimulation(input));
          setStatus("done");
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus("error");
        }
      }, 0);
    },
    [ensureWorker]
  );

  return { status, result, error, run };
}
