/// <reference lib="webworker" />
/**
 * Web Worker that runs the Monte-Carlo bootstrap off the main thread, so a
 * 10k+-path simulation never freezes the UI. It owns no DOM and no state — it
 * receives a SimInput, calls the pure `runSimulation`, and posts back a
 * SimResult. Instantiated from the UI via
 * `new Worker(new URL("./montecarlo.worker.ts", import.meta.url))` so Next's
 * bundler emits and fingerprints it as its own chunk.
 */
import { runSimulation, type SimInput, type SimResult } from "./simulate";

export type WorkerRequest = { id: number; input: SimInput };
export type WorkerResponse =
  | { id: number; ok: true; result: SimResult }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener("message", (e: MessageEvent<WorkerRequest>) => {
  const { id, input } = e.data;
  try {
    const result = runSimulation(input);
    const msg: WorkerResponse = { id, ok: true, result };
    ctx.postMessage(msg);
  } catch (err) {
    const msg: WorkerResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(msg);
  }
});
