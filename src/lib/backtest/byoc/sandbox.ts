/**
 * BYOC sandbox executor — runs untrusted user JavaScript in a QuickJS-WASM VM with
 * NO host access. Verified empirically: inside the VM, `fetch`, `window`, and
 * `process` are all `undefined`, so user code cannot reach the network, DOM, or
 * filesystem; it can only see the `bars` data + the injected `ta` library and must
 * return a value. Runs under the prod CSP (`wasm-unsafe-eval`, no `unsafe-eval`).
 *
 * Safety rails:
 *   - HEAP CAP via runtime.setMemoryLimit (default 64 MB) → a pathological alloc
 *     throws inside the VM instead of growing unbounded.
 *   - WALL-CLOCK BUDGET via runtime.setInterruptHandler — an infinite loop is
 *     interrupted at the deadline (classified as phase "timeout"), never hangs the
 *     tab.
 *   - The user's source is COMPILED FROM TEXT inside the VM only; we never accept
 *     or run bytecode, and the VM has no eval-to-host path.
 *
 * Pure module: the QuickJS WASM is lazy-loaded once and cached. Works in the
 * browser (BYOC page) and in node/vitest (the package ships a node-safe variant),
 * so the executor is unit-tested without a browser.
 */

import type { QuickJSWASMModule } from "quickjs-emscripten";
import { TA_STDLIB_SOURCE } from "./ta-stdlib";
import type { ByocBar, ByocResult, ByocRunOptions, ByocTrade } from "./types";
import { scoreTrades } from "./metrics";

let _modPromise: Promise<QuickJSWASMModule> | null = null;

/** Lazy-load + cache the QuickJS WASM module (one instantiate per session). */
async function getModule(): Promise<QuickJSWASMModule> {
  if (!_modPromise) {
    _modPromise = import("quickjs-emscripten")
      .then((m) => m.getQuickJS())
      .catch((err) => {
        _modPromise = null;
        throw err;
      });
  }
  return _modPromise;
}

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MEMORY_BYTES = 64 * 1024 * 1024;

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/** Build the full VM program: bars data + ta lib + user code + the scored call. */
function buildProgram(userCode: string): string {
  // `__BARS__` is replaced with the JSON data; everything else is literal source.
  return [
    "globalThis.bars = __BARS__;",
    TA_STDLIB_SOURCE,
    "globalThis.ta = ta;",
    "/* ---- user code ---- */",
    userCode,
    "/* ---- harness ---- */",
    ";(function () {",
    "  if (typeof strategy !== 'function') {",
    "    throw new Error('Define a function: strategy(bars, ta) { ... return trades }');",
    "  }",
    "  var out = strategy(globalThis.bars, globalThis.ta);",
    "  return JSON.stringify(out === undefined ? null : out);",
    "})()",
  ].join("\n");
}

/**
 * Run `userCode` against `bars` in the sandbox and score the returned trades.
 * Never throws — every failure (compile / runtime / timeout / bad shape) resolves
 * to an honest `{ ok: false, error, phase }`.
 */
export async function runByoc(
  userCode: string,
  bars: ByocBar[],
  opts: ByocRunOptions = {}
): Promise<ByocResult> {
  const logs: string[] = [];
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const memoryBytes = opts.memoryBytes ?? DEFAULT_MEMORY_BYTES;
  const started = now();

  let mod: QuickJSWASMModule;
  try {
    mod = await getModule();
  } catch (e) {
    return { ok: false, phase: "compile", error: `Sandbox failed to load: ${msg(e)}`, logs };
  }

  const ctx = mod.newContext();
  const deadline = now() + timeoutMs;
  let interrupted = false;
  try {
    ctx.runtime.setMemoryLimit(memoryBytes);
    ctx.runtime.setInterruptHandler(() => {
      if (now() >= deadline) {
        interrupted = true;
        return true;
      }
      return false;
    });

    // console.log capture (the only host hook; pushes strings into `logs`).
    const logFn = ctx.newFunction("log", (...args) => {
      logs.push(args.map((a) => stringifyHandle(ctx, a)).join(" "));
    });
    const consoleObj = ctx.newObject();
    ctx.setProp(consoleObj, "log", logFn);
    ctx.setProp(ctx.global, "console", consoleObj);
    consoleObj.dispose();
    logFn.dispose();

    const program = buildProgram(userCode).replace("__BARS__", JSON.stringify(bars));
    const res = ctx.evalCode(program);

    if (res.error) {
      const errVal = ctx.dump(res.error);
      res.error.dispose();
      if (interrupted) {
        return {
          ok: false,
          phase: "timeout",
          error: `Strategy exceeded the ${timeoutMs}ms time budget (possible infinite loop).`,
          logs,
        };
      }
      return { ok: false, phase: "run", error: formatVmError(errVal), logs };
    }

    const raw = ctx.dump(res.value);
    res.value.dispose();
    const trades = parseTrades(raw, bars.length);
    if (typeof trades === "string") {
      return { ok: false, phase: "shape", error: trades, logs };
    }
    const { scored, stats } = scoreTrades(trades, bars);
    return { ok: true, scored, stats, elapsedMs: Math.round(now() - started), logs };
  } catch (e) {
    return {
      ok: false,
      phase: interrupted ? "timeout" : "run",
      error: msg(e),
      logs,
    };
  } finally {
    ctx.dispose();
  }
}

/** Validate the user's returned value into a clean ByocTrade[] or an error string. */
function parseTrades(raw: unknown, barCount: number): ByocTrade[] | string {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return "strategy() must return JSON-serialisable trades.";
    }
  }
  if (value === null) return [];
  if (!Array.isArray(value)) {
    return "strategy() must return an array of trades, e.g. [{ entryIndex, exitIndex, side }].";
  }
  const out: ByocTrade[] = [];
  for (let i = 0; i < value.length; i++) {
    const t = value[i] as Record<string, unknown>;
    if (!t || typeof t !== "object") return `Trade #${i + 1} is not an object.`;
    const entryIndex = Number(t.entryIndex);
    const exitIndex = Number(t.exitIndex);
    const side = t.side === "short" ? "short" : t.side === "long" ? "long" : null;
    if (!Number.isInteger(entryIndex) || !Number.isInteger(exitIndex)) {
      return `Trade #${i + 1}: entryIndex/exitIndex must be integers.`;
    }
    if (side === null) return `Trade #${i + 1}: side must be "long" or "short".`;
    if (entryIndex < 0 || exitIndex >= barCount || exitIndex <= entryIndex) {
      return `Trade #${i + 1}: need 0 ≤ entryIndex < exitIndex < ${barCount}.`;
    }
    out.push({ entryIndex, exitIndex, side });
  }
  return out;
}

function stringifyHandle(ctx: ReturnType<QuickJSWASMModule["newContext"]>, h: unknown): string {
  try {
    // h is a QuickJSHandle; dump materialises it to a JS value.
    const v = ctx.dump(h as never);
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return "";
  }
}

function formatVmError(errVal: unknown): string {
  if (errVal && typeof errVal === "object") {
    const e = errVal as { name?: string; message?: string };
    if (e.message) return `${e.name ?? "Error"}: ${e.message}`;
  }
  return String(errVal);
}

function msg(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

/** TEST/HMR hook: drop the cached WASM module. */
export function __resetByocForTest(): void {
  _modPromise = null;
}
