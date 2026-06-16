# 14 — Bring-Your-Own-Code: Safe, Free, JS-only Sandbox

## Decision: JS-only via QuickJS-in-WASM (Pyodide dropped)

The live CSP allows `'wasm-unsafe-eval'` but **not** `'unsafe-eval'` — **Pyodide is CSP-blocked** without an app-wide security regression that would weaken the journal. JS-only is lighter (~500KB–1MB QuickJS vs multi-MB Pyodide), safer-by-default, and **reuses the Phase-2 TS indicator library** so no-code and BYOC are byte-identical. This supersedes the Python-oriented `04-byo-code.md` (rewritten alongside).

## Two-layer defense-in-depth

Neither a Worker alone nor an in-process sandbox alone is sufficient; they solve different halves and are **stacked**:

- **Web Worker** = ambient isolation (no DOM/window/localStorage/auth token in the worker realm) + the unconditional **`worker.terminate()`** hard-kill (the only timeout user code can never defeat).
- **QuickJS-emscripten** (untrusted code runs as _interpreted data_, separate WASM heap) = capability boundary (no host `fetch`/DOM/prototype reaches the host **by construction**) + in-engine CPU interrupt + memory ceiling.

## The network boundary is NOT CSP

Critical: the live `connect-src 'self' https: wss:` is intentionally wide-open for BYOD journals and **cannot be tightened per-page** (CSP is per-document). Likewise `worker-src 'self' blob:` is required (duckdb-wasm uses blob workers). So the network-exfiltration control is **QuickJS having zero host bindings** (the guest cannot name `fetch`) + the Worker holding **no token**. State this plainly; do not claim a `connect-src` allowlist as the boundary.

## Worker setup (`byoc.worker.ts` — NEW, not the pure-TS `backtest.worker.ts`)

```
const QuickJS = await getQuickJS();
const runtime = QuickJS.newRuntime();
runtime.setMemoryLimit(256 << 20);            // device-class
runtime.setMaxStackSize(512 << 10);
runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + 25_000));
const vm = runtime.newContext();              // RELEASE_SYNC build
```

- Worker created via `new Worker(new URL('./byoc.worker.ts', import.meta.url), {type:'module'})` — **never** from a blob/data URL.
- `postMessage` carries `{code, scope, config}` only — never a token, never a live object.

## ctx API (the ONLY capabilities exposed)

Built purely with `vm.newFunction` + `vm.setProp` onto the guest `ctx`:

- **Data (6, mirrors DataClient)**: `ctx.index`, `ctx.option`, `ctx.chain`, `ctx.expiries`, `ctx.nearestStrike`, `ctx.coverage`. The **host** performs the (allowlisted) read and returns plain rows; the guest names instruments, **never URLs**.
- **Indicators**: `ctx.ema/sma/rsi/vwap/atr/crossover` — the Phase-2 TS lib.
- **Output**: guest returns `ctx.trades([...])` or `ctx.equity(series)`; the existing TS engine prices charges/metrics/MC-cone. User code **never** computes P&L. zod-validate the dumped result on the main thread before rendering.

## Bounded pre-fetch (avoids ASYNCIFY)

Materialize the strategy's declared symbols/expiries/date-range (capped **~2M rows → `DataTooLarge`**) **before** calling `run(ctx)`, so guest `ctx.*` calls are synchronous (RELEASE_SYNC) and the transfer/rate budget is bounded. Reject unbounded data access from guest code.

## Watchdog & memory

- Main-thread `setTimeout(() => { worker.terminate(); showTimeoutCard(); spawnFreshWorker(); }, 30_000)`. The 25s in-engine deadline fires first (graceful translated 'Timeout' card); 30s `terminate()` is the unconditional backstop. Reusing a terminated worker is a bug — spawn fresh.
- Memory: `setMemoryLimit` caps the QuickJS heap; input row caps bound host-side arrays; `terminate()` is the backstop.

## Device-class cold-start

duckdb-wasm + QuickJS-WASM stacked stresses low-end Android. Lazy-init, single-WASM-at-a-time where possible, honest low-end fallback. **Benchmark a 100k-bar RSI loop in QuickJS before committing**; enforce the thin-guest/fat-host split (guest writes signal logic only; aggregation/charges run in native TS).

## Safety thesis

Client-side execution collapses the multi-tenant threat model: one anonymous tab, one public dataset, **no secret/tenancy** in the worker. The worst an attacker can do is harm their own tab. AST scanning (if added) is a fast-fail UX filter, **not** a security boundary.
