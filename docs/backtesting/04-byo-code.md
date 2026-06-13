# Bring-Your-Own-Code — UX & Security

> **Status:** ready-to-build · **Lane:** BYOC (Bring-Your-Own-Code) · **Universe:** standalone public `/backtesting`
> **Companion specs:** `01-overview.md`, `02-no-code-builder.md`, `03-data-layer.md`. This document is the single source of truth for the **code editor UX**, the **Pyodide + duckdb-wasm execution model**, the **security posture**, and the **user-facing data API** (`ctx`). The implementation workflow builds from this verbatim.

This is the **code-mode** half of the Backtesting universe — a public, login-free area reached from the marketing site header exactly like `/community`. A semi-technical Indian options trader writes Python, presses **⌘↵**, and watches a real backtest run **entirely in their own browser**. No server, no account, no cost to us. We nudge login **only when results are ready** (save / share / notify).

It is opinionated. Where there is a choice, the decision is stated and justified.

---

## 0. TL;DR decisions (read this first)

| Decision                     | Choice                                                                                                                                                 | Why                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **Route**                    | `/backtesting/code` (sibling to `/backtesting/builder`) — public, no auth gate                                                                         | Wired like `/community`: add a `Backtest` entry to `nav-links.tsx`, render via `site-header.tsx`                |
| **Default execution**        | **Client-side: Web Worker → Pyodide → duckdb-wasm pulling HF parquet ranges**                                                                          | $0 compute, zero server trust, infinite anonymous concurrency                                                   |
| **Server tier**              | **Deferred. Vercel Sandbox (Firecracker microVM), deny-all egress, paid only**                                                                         | Real isolation exists, but client-side removes ~90% of the threat model — don't pay for what you don't need yet |
| **Language surface**         | **Python only, one entry point `def run(ctx):`**                                                                                                       | Pyodide is the only viable in-browser Python; one contract is teachable                                         |
| **Data API**                 | **A tiny `ctx` object** — `ctx.index()`, `ctx.option()`, `ctx.chain()`, `ctx.nearest_strike()`, `ctx.expiries()`, `ctx.coverage()` + indicator helpers | Tiny, hand-stubbed, Ctrl-Click-documentable; the thing they must learn                                          |
| **Output contract**          | **Return `ctx.trades([...])` OR `ctx.equity(series)`; the engine computes P&L/charges/metrics**                                                        | Users write _signal logic_, not India-specific charge math (reuse `src/lib/charges`)                            |
| **Editor**                   | **Monaco** (lazy-loaded) + a curated `tm_runtime.pyi` stub for our ~12 symbols + Pine-style Ctrl-Click-to-docs                                         | Definition/hover/peek are first-class; generic Python LSP is deliberately omitted                               |
| **Hard kill**                | **`worker.terminate()` on a main-thread watchdog (30s)**                                                                                               | The _only_ reliable timeout for cooperative WASM; cannot be defeated by user code                               |
| **Memory cap**               | **Pre-sized Pyodide heap + input row caps; OOM → terminate + translated error**                                                                        | Browsers don't expose per-worker RAM quotas; prevent > detect > kill                                            |
| **Missing data**             | **Named, first-class state** — `option_or_nearest`, served-vs-requested, coverage %                                                                    | Pine's `na` philosophy; silent empty DataFrames destroy trust                                                   |
| **Login gating**             | **Never upfront.** Run completes anonymously, results render in full; nudge login only at save/share/notify                                            | Client-side $0 execution is what makes this generosity affordable                                               |
| **Rate limit (client)**      | **Soft per-tab `localStorage` token bucket**                                                                                                           | Can't trust the client; UX courtesy, not a control — it's the user's own CPU                                    |
| **Rate limit (server tier)** | **Hard, via existing `rateLimit(key, limit, windowSec)`**                                                                                              | Reuse `src/server/rate-limit.ts` verbatim                                                                       |

**Net build directive:** Open on a runnable template wired to a _well-covered_ expiry (never a blank file); put a searchable **data catalog with strike-coverage heatmaps + one-click query-insert** in the right rail; Monaco + a curated ~12-symbol stub + Ctrl-Click-to-docs; make missing data a **named, honest state**; **translate Pyodide tracebacks into plain-English cards** with a distinct valid-but-no-data state; stream the cold-start as intentional progress; render report-grade results (reusing charges / payoff / montecarlo) the instant a run finishes — and only then nudge login.

---

## 1. Information architecture & the two-mode relationship

```
/backtesting                 ← landing: "No-code builder" vs "Write code" cards + template gallery
/backtesting/builder         ← no-code wizard (companion spec)
/backtesting/code            ← THIS SPEC — BYOC editor (default opens a runnable template)
/backtesting/code?t=<id>     ← deep-link to a specific starter template
/backtesting/r/<runId>       ← saved/shared result permalink (login-gated to CREATE, public to VIEW)
```

A persistent, low-friction **mode toggle** lives in the editor's top bar so a no-code user can "graduate" and a coder can drop back. The strongest on-ramp is the no-code wizard's **"Eject to code"** button on its Review step: it serializes the visual strategy into a runnable, commented Python file and lands the user here **with their strategy already written**. They never face a blank editor — they face _their own strategy_ expressed as code they can now extend (Composer's "fork a working thing" principle, maximized).

---

## 2. Full desktop layout (≥1024px)

Three zones — editor center, icon rail right, console bottom — modeled on QuantConnect's proven idiom but lighter and friendlier.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  TradeMarkk · Backtest          [ No-code builder ‹—› ‹Code› ]      ◔ Runtime: ready   (sign in)│  ← site-header + mode toggle
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  MARKET SCOPE   Index [ NIFTY ▾ ]   Range [ 01 Jan 2024 → 31 Dec 2024 ]   Interval [ 5m ▾ ]     │  ← scope baked into ctx defaults
│                 Coverage for this scope:  ███████████░░░  82%   ⓘ 41 of 50 strikes present       │
├────────────────────────────────────────────────────────┬───────────────────────────────────────┤
│ ┌─ Tabs ────────────────────────────────────────────┐   │  ┌─ Right rail (icon switcher) ──────┐ │
│ │ strategy.py ×   ┊ + New   ┊  Templates ▾           │   │  │ ⌗ Data   ⓘ API   ⚑ Examples       │ │
│ ├────────────────────────────────────────────────────┤   │  ├───────────────────────────────────┤ │
│ │  1  def run(ctx):                                  │   │  │  DATA CATALOG          [ search ] │ │
│ │  2      spot = ctx.index()              # scope    │   │  │  ┌─────────────────────────────┐  │ │
│ │  3      exp  = ctx.expiries(kind="weekly")[0]      │   │  │  │ 🔎 Search instruments…      │  │ │
│ │  4      ce = ctx.option(exp, ("atm", 0), "CE")     │   │  │  └─────────────────────────────┘  │ │
│ │  5      pe = ctx.option(exp, ("atm", 0), "PE")     │   │  │  INDEX (spot)                     │ │
│ │  6      # 9:20 short straddle, fixed SL/target     │   │  │  ● NIFTY      ▰▰▰▰▰▰ 100%  ✓       │ │
│ │  7      rows = []                                  │   │  │  ● BANKNIFTY  ▰▰▰▰▰▰ 100%  ✓       │ │
│ │  8      # …signal logic…                           │   │  │  ● SENSEX     ▰▰▰▰▱▱  72%  ⚠       │ │
│ │  9      return ctx.trades(rows)                    │   │  │                                   │ │
│ │ ▏    ⌃-click any ctx.* symbol → inline docs        │   │  │  OPTIONS · NIFTY                  │ │
│ │                                                    │   │  │  expiry ▸ 26-Jun-2024 (weekly)    │ │
│ │                     (Monaco editor)                │   │  │  ┌─────────────────────────────┐  │ │
│ │                                                    │   │  │  │ strike  CE   PE   coverage   │  │ │
│ │                                                    │   │  │  │ 22400  ███  ███   96%  ✓     │  │ │
│ │                                                    │   │  │  │ 22450  ███  ██░   74%  ⚠     │  │ │
│ │                                                    │   │  │  │ 22500  ██░  ░░░   41%  ⚠ low │  │ │
│ │                                                    │   │  │  │ 22550  ███  ███   88%  ✓ ←ATM│  │ │
│ │                                                    │   │  │  └─────────────────────────────┘  │ │
│ │                                                    │   │  │  type ( • CE   ○ PE )             │ │
│ │                                                    │   │  │  [ ＋ Insert query: NIFTY 22550 CE]│ │  ← one-click snippet
│ └────────────────────────────────────────────────────┘   │  │  [ ⧉ Copy as duckdb SQL ]         │ │
│                                                          │  └───────────────────────────────────┘ │
├────────────────────────────────────────────────────────┴───────────────────────────────────────┤
│ ⌗ Console   ⚠ Problems (0)   📡 Data log        🔒 Runs in YOUR browser · nothing sent to us  ⓘ │  ← console tabs + security strip
│ > Python runtime ready (2.1s) · duckdb-wasm ready                                                │
│ > Tip: press ⌘↵ to run. Ctrl-Click any ctx.* symbol for docs.                                    │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  [ ▶ Run backtest  ⌘↵ ]   [ ⟳ Clear ]   [ ◇ Format ]            coverage for this run: 81% ⚠   │  ← action bar (sticky)
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Layout numbers:**

- Right rail: **320px** expanded, collapsible to a **48px** icon strip. Three icon-panels: **Data** (catalog, default-open), **API** (docs), **Examples** (runnable templates).
- Console: bottom dock, default **180px**, drag-resizable, collapsible to a 36px tab bar.
- Editor center fills the rest. On a 1440px screen: editor ~760px, rail 320px, 24px gutters.
- The **Market Scope bar** sits above the editor and bakes index + range + interval into `ctx` defaults (see §4.2) so calls are terse.
- The **action bar is sticky** at the bottom of the editor column — Run must never scroll away.
- Motion: panels/console slide with decelerate `cubic-bezier(0,0,0.2,1)` at ~200ms; rail icon-panel swap cross-fades at 150ms. Honor `prefers-reduced-motion`.

---

## 3. The Monaco editor

**Recommendation: Monaco, not CodeMirror** — Ctrl-Click-to-definition, hover cards, multi-cursor and a peek widget are first-class, and Pine's "Ctrl-Click any symbol → inline docs" (the best discoverability feature in the teardown) maps directly onto Monaco's `registerDefinitionProvider` + `registerHoverProvider`. Lazy-load it (`@monaco-editor/react` dynamic import) so it never blocks first paint.

### 3.1 Curated type stub, NOT a generic Python LSP

QuantConnect's half-working autocomplete (covers framework members, not user objects) actively teaches distrust. We ship a single hand-authored **`tm_runtime.pyi`** stub for our `ctx` API only, registered as Monaco hover + completion + signature-help. Generic Python intellisense is deliberately omitted — coverage of _our_ tiny API is the only thing that matters.

The complete public surface the stub documents (small on purpose — this is the whole language they must learn):

```python
# ── ENTRY POINT ──────────────────────────────────────────────────────────
def run(ctx) -> "Trades | Equity": ...
#   Define exactly one function named run(ctx). Return ctx.trades([...]) (recommended)
#   or ctx.equity(series). The engine prices trades + computes all metrics.

# ── DATA (ctx) ───────────────────────────────────────────────────────────
ctx.index(symbol=None, start=None, end=None, interval=None) -> DataFrame
#   Index spot OHLC(V). symbol ∈ {"NIFTY","BANKNIFTY","SENSEX"}. Args default to Market Scope.
#   cols: timestamp, open, high, low, close, volume, trading_day

ctx.option(symbol=None, expiry=None, strike=None, option_type=None,
           start=None, end=None, interval=None) -> OptionFrame
#   One option contract's OHLC + OI. option_type ∈ {"CE","PE"}.
#   If the exact strike is MISSING, behaviour is controlled by ctx.config(on_missing=...).
#   Default on_missing="nearest" → serves nearest available strike, flags it (NEVER silent).
#   cols: timestamp, open, high, low, close, volume, open_interest, strike, option_type, expiry
#   .meta: { requested_strike, served_strike, coverage, is_nearest }   ← attached attribute

ctx.chain(symbol=None, expiry=None, at=None, width=10) -> DataFrame
#   Option-chain snapshot at timestamp `at`: ATM strike ± width strikes, both CE & PE,
#   with last close, OI, and a per-strike `coverage` column. premium/delta selectors build on this.

ctx.expiries(symbol=None, kind="weekly", on=None) -> list[date]
#   Available expiries (kind ∈ {"weekly","monthly","all"}), optionally those live on date `on`.

ctx.nearest_strike(symbol=None, expiry=None, target=None, option_type=None, at=None) -> StrikeInfo
#   Resolve a desired strike to the nearest AVAILABLE strike. target may be:
#     int (absolute) | ("atm", offset) | ("premium", rupees) | ("delta", value)
#   returns StrikeInfo{ strike, served_premium, coverage, distance_pts, is_exact }

ctx.coverage(symbol=None, expiry=None, strike=None) -> Coverage
#   Honest data-availability for a scope:
#     { pct, n_strikes_present, n_strikes_expected, missing_strikes:[...], sparse_strikes:[...], date_gaps:[...] }

# ── OUTPUT (ctx) ─────────────────────────────────────────────────────────
ctx.trades(rows: list[dict]) -> Trades     # recommended — engine prices + scores them
ctx.equity(series) -> Equity               # advanced — raw account value; charges/slippage NOT modeled

# ── CONFIG (ctx) ─────────────────────────────────────────────────────────
ctx.config(on_missing="nearest"|"raise"|"empty", capital=..., charges_broker="zerodha") -> None

# ── INDICATOR HELPERS (ctx) — pure pandas/numpy, so users don't reach for ta-lib ──
ctx.ema(series, n)   ctx.sma(series, n)   ctx.rsi(series, n)
ctx.vwap(df)         ctx.atr(df, n)       ctx.crossover(a, b) -> "bool Series"
```

> **"That's the whole API. If you can read these ~12 functions, you can backtest anything we support."** — the persistent note atop the API panel.

### 3.2 Ctrl/Cmd+Click → inline doc card (Pine's killer feature)

Every `ctx.*` symbol resolves to a doc card: one-line summary, signature, a _"this raises / serves-nearest when…"_ note, and an **[Insert example]** button. The same card opens on hover after 400ms. Error cards (§9) reuse this surface — the offending symbol in a runtime error links straight to its doc card.

### 3.3 Shortcuts, persistence & banner

- **Run** `⌘↵ / Ctrl+↵`, **Format** `⇧⌥F`, **Command palette** `⌘K` ("Run", "Switch index → BANKNIFTY", "Insert: short straddle", "Insert: SL/target block", "Open results", "Compare runs").
- **Auto-persist to `localStorage`** on every change (debounced 500ms), keyed by template id, plus an in-memory undo stack — anonymous users must never lose code on refresh. A subtle **"Saved locally · 3:42pm"** affordance sits by the tabs. This is NOT an optimistic server-save (that would gate login).
- **Banner line at top of every template:** `# Runs entirely in your browser. Edit freely — ⌘↵ to run.` plus an optional hypothesis one-liner the user can fill: `# Hypothesis: selling 9:20 ATM straddle on expiry day is net-positive after costs.`

---

## 4. The data API exposed to user code (`ctx`)

This is the single most important ergonomic surface — and where we out-design every competitor, because **missing/illiquid strikes are a named, first-class concept** (Pine's `na` philosophy), not a silent empty DataFrame.

`ctx` is constructed by our `tm_runtime.py` shim and passed into `run(ctx)`. Under the hood every method issues a **DuckDB SQL range-read against HF parquet** (`hf://` / httpfs) and returns pandas. The user never writes SQL or a URL.

### 4.1 The "import data + pick range" ergonomics (the headline)

The first wall for a semi-technical user is **"what do I type and does it exist?"** We collapse it three ways.

**(a) The range is set once, declaratively; `ctx` is pre-scoped.** The Market Scope bar (above the editor) picks index + date range + interval _before_ writing code. Those become the **defaults baked into `ctx`** so calls are terse; any positional/keyword arg **overrides** the scope per call:

```python
def run(ctx):
    # ctx already knows: symbol="NIFTY", 2024-01-01 → 2024-12-31, interval="5m"
    spot   = ctx.index()                                   # no args — uses scope defaults
    expiry = ctx.expiries(kind="weekly", on="2024-06-26")[0]
    ce     = ctx.option(expiry=expiry, strike=("atm", 0), option_type="CE")
    pe     = ctx.option(expiry=expiry, strike=("atm", 0), option_type="PE")
    # …multi-symbol work just passes symbol= explicitly to override scope…
    return ctx.trades(rows)
```

**(b) One-click "insert query snippet" from the data catalog.** The right-rail Data panel lists the 3 indices → expiries → a strike-coverage heatmap. Clicking a cell **injects the exact call** at the cursor:

```python
# inserted by clicking NIFTY · 26-Jun-2024 · 22550 CE  (coverage 88%)
ce = ctx.option(symbol="NIFTY", expiry="2024-06-26", strike=22550, option_type="CE")
```

A secondary **"Copy as duckdb SQL"** reveals the raw `SELECT … FROM 'hf://…/options/NIFTY/26Jun24.parquet' WHERE strike=22550 …` for power users. This eliminates the "what string do I type" failure mode that sinks QuantConnect beginners.

**(c) Missing data is named, never silent (the differentiator).** `ctx.option()` on a missing strike does NOT return an empty frame. Default config `on_missing="nearest"`:

```python
ce = ctx.option(expiry=expiry, strike=22500, option_type="CE")
print(ce.meta)
# {'requested_strike': 22500, 'served_strike': 22550, 'coverage': 0.71, 'is_nearest': True}
```

The UI surfaces a coverage chip on the result and a one-line banner: _"Requested 22500 → served 22550 (71% coverage)."_ Configurable per `ctx`:

```python
ctx.config(on_missing="nearest")   # default — serve nearest available strike, flag it
ctx.config(on_missing="raise")     # strict — raise MissingStrike (caught + translated to a no-data card)
ctx.config(on_missing="empty")     # advanced — return empty frame, user handles na themselves
```

This is the BYOC mirror of the no-code "coverage badge," and the single feature none of AlgoTest / Sensibull / Opstra / Tradetron / Streak do honestly.

### 4.2 Strike resolution semantics

`("atm", n)` → nearest listed strike to spot, then ±n strike steps (NIFTY 50-pt, BANKNIFTY 100-pt, SENSEX 100-pt grids — encoded per symbol). `("premium", ₹)` and `("delta", d)` → computed over `ctx.chain(...)` at the entry timestamp. All three resolve through `nearest_strike()` and **carry coverage**. If even the nearest has coverage below a floor (default 20%), we still serve it but mark `is_low_confidence=True` and the results screen shows a **red honesty chip**.

### 4.3 How `ctx` actually fetches (and the network allowlist)

- Each method builds a parameterized DuckDB SQL string and runs it via duckdb-wasm `httpfs` against
  `https://huggingface.co/datasets/thetrademarkk/india-index-options-1m/resolve/main/...`.
- **Range reads only** — DuckDB reads parquet footers + the needed row groups, never the whole file.
- **Narrowest-slice principle:** push all filtering (date range, strike, time-of-day) into the SQL `WHERE`; never `SELECT *` a whole expiry into pandas. Do heavy aggregation (resampling, OI deltas) in **DuckDB SQL, not pandas** — Pyodide pandas is the slow path and the arrow→`list[dict]`→DataFrame copy is the bottleneck (**`pyarrow` is NOT available in Pyodide** — the shim does this copy for the user).
- **The worker's network is allowlisted to exactly that HF host:** (1) duckdb-wasm is configured with the HF base URL and user code cannot pass arbitrary URLs (no raw URL parameter is exposed on `ctx`); (2) a strict **CSP `connect-src`** limits fetch destinations to the HF host + same origin. User Python has no `fetch`/`socket` at all (§7.3), so this is defense-in-depth.
- A small **per-slice memoization cache** cuts redundant pulls within a session.

### 4.4 Indicator helpers (so users don't reach for unavailable libs)

Because `ta-lib`/`scipy` aren't shipped, common indicators are `ctx` helpers operating on a DataFrame column — pure pandas/numpy under the hood, hand-stubbed for autocomplete + Ctrl-Click docs:

```python
ctx.ema(series, n)      ctx.sma(series, n)      ctx.rsi(series, n)
ctx.vwap(df)            ctx.atr(df, n)          ctx.crossover(a, b) -> bool Series
```

### 4.5 The right rail — three tabs

**`⌗ Data` (default).** The live catalog: search → 3 indices → expiries → strike-coverage heatmap. Each strike shows a coverage bar + percentage + status chip (`✓ good` / `⚠ sparse` / `✗ none`), driven by `ctx.coverage()` (computed once via a single duckdb-wasm footer aggregate — range-read, no full download; see `src/lib/backtesting/coverage.ts`). ATM is marked relative to spot at the chosen date. **One-click "Insert query"** injects the exact `ctx.option(...)` call. **Degraded honesty:** if the chosen expiry has <50% mean coverage, a banner steers the beginner to a cleaner slice — _"This expiry is sparse (avg 48%). Consider 27-Jun (94%) for a cleaner first run."_ — so the first run never hits an empty state.

**`ⓘ API`.** A compact, scannable reference for the same ~12 symbols, each a collapsible card: signature, one-paragraph description, the **raises / missing-data behavior** called out explicitly, and a copy-paste mini-example. Grouped by entry-point / data / output / config / indicators. Persistent top note (see §3.1).

**`⚑ Examples`.** Five runnable starters (§8.4) — **hard rule: every example runs end-to-end on the first click**, pre-wired to a real expiry that _actually has coverage_, framed as "wiring demos, not trading advice."

---

## 5. The Run loop, console & progress

**Felt experience target:** Composer/Pine instant-feedback on the front, QuantConnect depth on demand. The wait must feel _intentional_, not broken — Pyodide cold-start is seconds.

### 5.1 Run states (action bar `▶ Run backtest`)

1. **Idle** → `▶ Run backtest ⌘↵`.
2. **Cold-start (first run only)** → a determinate-feel sequence streamed into the console + a thin top progress bar. Naming each phase makes the wait read as progress:
   ```
   > Loading Python runtime…           ▰▰▰▱▱▱  (Pyodide, ~2–3s, cached after first run)
   > Loading data engine (duckdb)…     ▰▰▰▰▰▱
   > Pulling NIFTY 26-Jun slice from HuggingFace…  3,120 bars
   > Running run(ctx) over 124 trading days…       ▰▰▰▰▰▰
   ```
3. **Running** → button becomes `■ Stop` (= `worker.terminate()`; long client runs must be cancellable).
4. **Done** → action bar flips to `✓ Done in 4.2s · View results ↓` and the results panel reveals (§10). Transition kept under ~375ms so it reads as an _arrival_.

### 5.2 Running-state widget (narrated cold-start)

```
┌──────────────────────────────────────────┐
│  ◐  Running…                    [ Cancel ]│   ← Cancel = worker.terminate()
│  ✓ Python runtime ready (3.1s)            │
│  ✓ Pulled NIFTY 26-Jun (12,480 bars)      │
│  ◐ Evaluating run(ctx)…  ▓▓▓▓▓░░░ 64%     │   ← progress posts from the shim
│  watchdog: stops automatically at 0:30    │
└──────────────────────────────────────────┘
```

### 5.3 Console — three tabs

- **`⌗ Console`** — `print()` output, run summary lines, tips. Color-coded: info muted, success profit-green, warnings amber. Debug spam rate-limited to ~1 line/sec so a `print` in a per-bar loop can't flood.
- **`⚠ Problems`** — pre-run static issues + translated runtime errors (§9), each a clickable card that jumps to the offending line.
- **`📡 Data log`** — every data fetch with served-vs-requested strike and coverage, e.g. `ctx.option NIFTY 23200 CE → 52% coverage (sparse)` / `served 23000 (req 23300 had 0%)`. This is where the honest data model becomes **auditable** — the user can see exactly what was filled.

---

## 6. High-level architecture

```
┌──────────────────────────────────── BROWSER (the trust boundary is HERE) ──────────────────────────────────────┐
│                                                                                                                 │
│  MAIN THREAD (React 19 / Next 15)                          WEB WORKER  (sandbox: no DOM, no window, no parent)   │
│  ┌───────────────────────────────┐                        ┌───────────────────────────────────────────────┐    │
│  │  Editor (Monaco)              │   postMessage(RunMsg)   │  Pyodide runtime (lazy-loaded, cached)        │    │
│  │  Data catalog rail            │ ──────────────────────► │   ├─ user strategy module  (def run(ctx): …)  │    │
│  │  Run button + watchdog timer  │                        │   ├─ tm_runtime.py  (our shim: builds `ctx`)   │    │
│  │  Results dashboard            │ ◄────────────────────── │   └─ duckdb-wasm  ── range-reads parquet ──┐   │    │
│  └───────────────────────────────┘   postMessage(Result)  └────────────────────────────────────────│──┘    │
│           │  terminate() on timeout/cancel  ▲                                                       │         │
│           └─────────────────────────────────┘                                                       │         │
└─────────────────────────────────────────────────────────────────────────────────────────────────│─────────┘
                                                                                                     │ HTTPS range GET
                                                                        (allowlisted host only)      ▼
                                                            ┌──────────────────────────────────────────────────┐
                                                            │  HuggingFace  thetrademarkk/india-index-options-1m │
                                                            │  index/{SYM}.parquet  options/{SYM}/{EXPIRY}.parquet│
                                                            └──────────────────────────────────────────────────┘

  (OPT-IN PAID SERVER TIER — deferred, only for heavy runs)
  Next.js route → AST static check → Vercel Sandbox (Firecracker microVM, deny-all egress, CPU/mem/time caps)
                → after()/QStash → notifications table + Resend email → client poll
```

**Key invariants:**

- The worker has **no reference to the page, `window`, cookies, `localStorage`, or any auth token.** It is a structurally-cloned message island.
- Data flows **into** the worker only as bytes fetched by duckdb-wasm from the public HF host. No app API, no DB.
- Results flow **out** only as a single serializable `BacktestResult` object, **validated with zod on the main thread** before rendering.

**Worker message contract (copy verbatim from `montecarlo.worker.ts`):**

```ts
// Mirrors src/lib/montecarlo/montecarlo.worker.ts exactly, plus streamed progress.
export type RunInput = { code: string; scope: Scope; config: CtxConfig };

export type WorkerRequest = { id: number; input: RunInput };

export type WorkerResponse =
  | { id: number; ok: true; result: BacktestResult }
  | { id: number; ok: false; error: TranslatedError }
  | { id: number; ok: "progress"; phase: string; pct: number; detail?: string }; // streamed

// Instantiate so Next fingerprints it as its own chunk:
// new Worker(new URL("./backtest.worker.ts", import.meta.url))
```

Pyodide + duckdb-wasm live **inside the worker**; the main thread only posts code + scope and receives progress events + the final result.

---

## 7. The execution kernel (shared by no-code and BYOC)

Both lanes compile to the **same `RunInput` and the same `BacktestResult`**. The no-code wizard _generates_ a strategy spec our engine evaluates; BYOC _is_ the strategy. One worker, one watchdog, one results renderer.

### 7.1 The user contract — one entry point

User code must define exactly one function:

```python
def run(ctx):
    """
    ctx : Context — the data + helpers API (see §4).
    return: either
        ctx.trades(rows)     # list of Trade dicts (recommended; engine prices them)
      | ctx.equity(series)   # a pandas Series/DataFrame of per-bar account value (advanced)
    """
```

We do **not** let user code compute final P&L, charges, or metrics. They emit _trades_ (entry/exit time, symbol, side, qty, price); **our TypeScript engine applies `src/lib/charges` (STT/GST/stamp/brokerage), slippage, and computes all metrics** (§10). Charges are India-specific, broker-specific, and a correctness liability we already own and test (`charges.golden.test.ts`) — letting users reinvent them produces wrong, unfalsifiable backtests. A user may instead return a raw equity series for exotic strategies; then we skip charge application and warn (_"equity returned directly — charges/slippage not modeled"_).

### 7.2 Entry-point discovery & validation

- After Pyodide loads the module, the shim checks `"run" in user_globals and callable(user_globals["run"])`. Missing/!callable → a **pre-run, plain-English error** (not a traceback): _"Your code needs a function named `run(ctx)`. Add `def run(ctx):` and return `ctx.trades([...])`."_
- We call `run(ctx)` inside a `try/except` in the shim and translate exceptions (§9).

### 7.3 Available packages (the allowlist — opinionated)

Ship **only** what is (a) bundled in the Pyodide distribution we pin and (b) useful for index-options backtesting. No arbitrary `micropip` from user code (it is **not exposed** to user globals).

**Allowed (preloaded into the worker image):** `pandas`, `numpy`, `duckdb` (wasm; user code rarely touches it directly — `ctx` wraps it).

**Explicitly absent (and we say so in docs):**

- `requests`, `urllib`, `socket`, raw `fetch`, `pyfetch` — **no network from user code.** All data comes through `ctx`.
- `os`, `subprocess`, `sys.exit`, file writes — Pyodide's virtual FS is per-worker and ephemeral; `open()` for writing is pointless (discarded on terminate) and documented as unsupported.
- `pyarrow` — **NOT available in Pyodide.** Do not promise it; the shim copies query results arrow→`list[dict]`→DataFrame for the user.
- `ta-lib`, `scipy.signal`, ML stacks — out of scope for v1. Indicators ship as `ctx` helpers (§4.4) so users don't need them.

**Decision:** a _curated_ package set beats "install anything" — it keeps the WASM image small (first-load size is the real cost), keeps autocomplete honest, and removes the supply-chain attack surface entirely.

### 7.4 Pyodide lifecycle & caching

- **Lazy-load.** Do NOT block the editor on Pyodide. The worker is spawned and `loadPyodide()` begins **on first Run**, not on page mount. The editor is usable instantly.
- **Cache the WASM + wheels** via the service worker (PWA) + HTTP cache. First run is a cold start (seconds); subsequent runs reuse the warm worker.
- **Warm-worker reuse:** keep one initialized worker alive per tab between runs (re-run just re-imports the user module). Recreate it after a `terminate()`.
- **Lazy-load Monaco AND Pyodide; never block first paint on either.**

---

## 8. Security & trust model

### 8.1 Threat model — why client-side execution wins

The hardest, most expensive "run user code" problems are **server-side**. Client-side execution moves the blast radius onto the user's own machine:

| Threat                                   | Server-run risk                       | Client-run (our default) outcome                                                                                        |
| ---------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Sandbox escape → host filesystem         | Catastrophic (host is yours)          | The "host" is the user's own browser tab. They can only attack themselves.                                              |
| Secret / credential exfiltration         | High — env vars, DB tokens on the box | **No secrets in the worker.** The HF dataset is public; no auth token is ever shipped to client code. Nothing to steal. |
| Cross-tenant data read                   | High                                  | No tenancy in the worker — one tab, one anonymous user, one public dataset.                                             |
| Network egress abuse (SSRF, spam, proxy) | High — your IP, your reputation       | duckdb-wasm fetches are **allowlisted to the HF host only**; user Python has **no socket/`fetch`** inside Pyodide.      |
| Compute cost / cryptomining              | You pay the CPU bill                  | **The user pays their own CPU.** A runaway loop burns _their_ battery; we kill it in 30s anyway. $0 to us.              |
| Persistence / lateral movement           | Real                                  | Worker is ephemeral; `terminate()` reclaims everything; no shared host.                                                 |
| Supply-chain (malicious install)         | Real if arbitrary installs allowed    | Fixed allowlist of Pyodide-bundled wheels (§7.3); no arbitrary `micropip`.                                              |

The one residual client-side risk is **denial-of-service against the user themselves** (hang the tab, exhaust RAM), bounded by: the off-main-thread Web Worker (UI never freezes), the `worker.terminate()` watchdog (§8.2), and a pre-sized heap (§8.3). None threaten _us_.

**Design thesis:** by defaulting to client-side, the security spec for the common case collapses from "build a hardened multi-tenant sandbox" to _"don't ship secrets to the client and put a watchdog on a worker."_

### 8.2 Time limits & the hard kill (`worker.terminate()`)

WASM/Pyodide runs **cooperatively** on the worker thread — there is no preemptive interrupt you can rely on from inside. The only bulletproof timeout is to kill the worker from the **main thread**.

```
MAIN THREAD                                    WORKER
  run() clicked                                  (idle, warm)
   ├─ start watchdog: setTimeout(KILL, 30_000)
   ├─ postMessage({id, input:{code, scope}})  → import module, call run(ctx)
   │                                              ├─ duckdb fetch + compute…
   │  ◄── {id, ok:"progress", phase, pct}        ├─ periodic progress posts
   │  ◄── {id, ok:true, result}  OR              └─ done → postMessage(result)
   │      {id, ok:false, error}
   └─ on result/error: clearTimeout(watchdog)
   └─ on watchdog fire: worker.terminate(); show "Run exceeded 30s — stopped"; spawn fresh worker
```

- **Hard wall: 30s** for client-side runs (covers a multi-month 1m backtest over a narrow slice). Tunable _down_ per device class; never up on the client.
- **`worker.terminate()` is the kill switch.** It cannot be blocked by user code (no `try/finally` in the worker survives it) — the whole thread is destroyed and GC'd. This is also the **Cancel** button behavior; same code path.
- After terminate we **spawn a fresh worker** and re-init Pyodide lazily on the next run. We never reuse a terminated worker.
- **Soft check (UX courtesy only):** the shim posts `progress` every N processed bars; if the main thread sees no progress for ~10s it shows "still working…". The 30s terminate is the real control.

**Why not `Atomics.wait` / interrupt buffers?** Pyodide's interrupt buffer only fires at Python bytecode boundaries and can be starved by a tight C-level loop in numpy/duckdb. We do not depend on it. `terminate()` is unconditional and authoritative. (We may _also_ set an interrupt buffer as best-effort soft-cancel, but it is not on the critical path.)

### 8.3 Memory limits

Browsers don't expose a per-worker RAM quota, so we bound memory three ways (in priority order — **prevent > detect > kill**):

1. **Bound the input at the data layer (the real lever).** `ctx` enforces a max rows-per-query and a max total fetched rows per run (e.g. **2M rows**). Exceeding it raises `DataTooLarge` _before_ pandas blows up, with a plain-English remedy — most OOMs are "user fetched a year of 1m for 20 strikes."
2. **Pre-size the Pyodide/WASM heap** at init to a fixed ceiling (~512MB–1GB by device class). Overflow → `MemoryError` / WASM abort → the shim catches it (or the worker dies) → main thread shows a **translated** error.
3. **Watchdog backstop.** A worker thrashing on GC misses progress and hits the 30s terminate anyway.

### 8.4 Trust messaging (friendly, specific, repeated)

1. **Persistent console strip (always visible):** `🔒 Runs in YOUR browser · nothing is sent to our servers`.
2. **First-visit one-time card** (dismissible, remembered in `localStorage`):
   ```
   ┌─ How this works ───────────────────────────────────────────┐
   │ 🔒 Your code runs entirely in your own browser.            │
   │    • We never see or store your strategy.                  │
   │    • Market data is read directly from a public dataset.   │
   │    • Nothing is sent to our servers — even the results     │
   │      stay on your device until you choose to save them.    │
   │    [ Got it ]   [ How is this possible? ]                  │
   └────────────────────────────────────────────────────────────┘
   ```
   "How is this possible?" expands: Pyodide (real Python compiled to WebAssembly) + duckdb-wasm reading public HuggingFace parquet via range requests.
3. **At the save/share nudge:** _"Saving uploads only the result snapshot you choose — your code stays private unless you tick 'include code'."_
4. **Mandatory educational disclaimer (constraint):** a permanent footer on the results panel — _"Backtests use historical data with patchy coverage and assume fills at recorded prices. Past performance does not predict future results. Beware overfitting — a great backtest is easy to fake."_ The Monte-Carlo cone + coverage chips operationalize this honesty rather than just asserting it.

---

## 9. Error surfacing — translate, never dump

A raw Pyodide `KeyError`/`IndexError`/traceback will terrify the audience. The shim catches the exception in the worker, extracts `{type, message, lineno}` from the Python traceback, and posts a **structured `TranslatedError`** the main thread renders as a card. **Three explicitly distinct states**, each styled differently (Pine and QuantConnect blur the third into generic runtime errors — we don't).

### State A — Syntax / compile error (before run) — red

Caught by a lightweight pre-run parse in the worker + Monaco lint. Card in **Problems**, not a raw dump:

```
┌ ⚠ Problems (1) ───────────────────────────────────────────────┐
│ ✗ Syntax error near line 13                                    │
│   Looks like a missing ) on line 12.  ← we check the line ABOVE│
│   data.option("NIFTY", 22500, "CE"   ← here                    │
│   [ Jump to line 12 ]                                          │
└────────────────────────────────────────────────────────────────┘
```

We **never trust the reported line blindly** — Pine's #1 trap is highlighting where the error was _detected_, not _caused_ (~30% wrong, usually 1–2 lines above). We show ±2 lines of context and explicitly hint "check the line above."

### State B — Runtime error (during run) — amber, translated, never dumped

We map common cases to plain-English cards and link the offending `ctx` symbol back to its doc card:

```
┌ ⚠ Runtime error ──────────────────────────────────────────────┐
│ Your strategy used `ce` before it held any data.               │
│ Line 14:  bt.sell(ce, lots=1)                                  │
│ → `ce` is empty because line 13 hit a MissingStrike error.     │
│ Fix: set ctx.config(on_missing="nearest") or use ctx.chain().  │
│ [ Jump to line 13 ]   [ What is coverage? ]   [ Show details ] │
└────────────────────────────────────────────────────────────────┘
```

`[Show details]` reveals the real traceback for users who want it — translate by default, never hide entirely.

### State C — Valid run, but no data (THE patchy-coverage case) — blue, reassuring, actionable

A successful run that returned an empty/degraded result is **not** an error. It is the most important state we ship given patchy coverage:

```
┌ ◔ Run finished — but this strike isn't in the dataset ─────────┐
│ No data for NIFTY 23300 CE on 27-Jun                           │
│ (that strike has 0% coverage in the public dataset).           │
│                                                                │
│ Nearest available: 23000 CE  (98% coverage)                    │
│ [ Re-run with 23000 CE ]   [ Use on_missing="nearest" ]        │
│                                                                │
│ Why does this happen? Our HuggingFace dataset captures 40–68%  │
│ of strikes — illiquid/far-OTM strikes are often missing. This  │
│ is expected, not a bug. [ Learn about coverage ]               │
└────────────────────────────────────────────────────────────────┘
```

**Common translations table (shipped):**

```
SyntaxError                  → "Missing ) — check line 12 (often the line ABOVE the flagged one)."
KeyError 'close'             → "No 'close' column — did you mean ctx.index() (spot) vs ctx.option()?"
MissingStrike(22500)         → no-data card (State C) with nearest-strike CTA
DataTooLarge                 → "Too many rows — narrow dates or use a larger interval (5m vs 1m)."
MemoryError / WASM abort     → "Ran out of memory — fetch fewer strikes / shorter range."
NameError: 'run' not defined → "Add a function `def run(ctx):` and return ctx.trades([...])."
Timeout (watchdog)           → "Run exceeded 30s and was stopped. Narrow the range or simplify the loop."
ValidationError (zod)        → "Your run() returned something we couldn't read — return ctx.trades([...])."
```

### No-data / nearest-strike card (inline differentiator)

```
┌─────────────────────────────────────────────────────────────┐
│  ⓘ  Nearest strike used                                       │
│  You asked for NIFTY 22500 CE (26-Jun) — only 41% coverage.   │
│  Served 22550 CE instead (88% coverage, 50 pts away).         │
│  [ Use 22550 ✓ ]   [ Keep 22500 anyway ]   [ Pick another ▾ ] │
└─────────────────────────────────────────────────────────────┘
```

---

## 10. Results — the engine boundary + shared report UX

User code returns trades; **our engine** prices and scores them. One schema in, one schema out — identical for no-code and BYOC, so the results dashboard is shared.

### 10.1 The Result contract

```ts
// what the worker posts back to the main thread (validated with zod before render)
type BacktestResult = {
  schema: "tm.backtest.v1";
  source: "byoc" | "nocode";
  scope: { symbol: Sym; start: string; end: string; interval: Interval };

  trades: Trade[]; // user-emitted, post-priced by engine
  equity: { t: string; value: number }[]; // computed by engine (or user-supplied)

  metrics: {
    // computed by engine, NOT by user code
    totalPnl: number;
    totalPnlPct: number;
    returnOverMaxDD: number;
    maxDrawdown: number;
    maxDDDuration: number;
    expectancy: number;
    winRate: number;
    sharpe: number;
    nTradeDays: number;
    avgWin: number;
    avgLoss: number;
    charges: number; // from src/lib/charges
  };

  coverage: {
    // the honesty layer
    pct: number; // overall strike coverage used
    servedSubstitutions: { requested: number; served: number; n: number }[];
    lowConfidence: boolean;
    dateGaps: string[];
  };

  warnings: string[]; // "served nearest strike", "equity returned directly", …
};

type Trade = {
  entryTs: string;
  exitTs: string;
  symbol: string;
  expiry?: string;
  strike?: number;
  optionType?: "CE" | "PE";
  side: "buy" | "sell";
  qty: number; // qty is LOT-SCALED (NIFTY 75 / BN 35 / SENSEX 20)
  entryPrice: number;
  exitPrice: number;
  // engine fills: grossPnl, charges, netPnl, mae, mfe
};
```

### 10.2 Engine responsibilities (TypeScript — reuse, do not rebuild)

- **Costs** — every trade priced through **`src/lib/charges/charges.ts`** via `computeCharges(profile, t: TradeForCharges)`, so P&L is net of STT/GST/stamp/brokerage. `TradeForCharges` expects `{ segment: "OPT", product, qty, entryPrice, exitPrice, direction, orders }` per leg; **`qty` is already lot-scaled** (one NIFTY lot = 75) — same convention as `payoff.ts`. A coverage chip + "Costs incl. (Zerodha)" chip sit in the verdict row.
- **Per-leg payoff diagram** — reuse **`src/lib/options/payoff.ts`** (`PayoffLeg { strike, optionType, direction, qty, premium }`, `strategyPayoffAt(legs, underlying)`) to draw the structure alongside realized per-leg P&L. The lot-scaled `qty` convention is identical. This per-leg view is largely absent in Western BYOC tools — a differentiator.
- **Monte-Carlo drawdown cone** — feed the per-trade P&L sequence (as R-multiples) into the existing **`src/lib/montecarlo/montecarlo.worker.ts`** via its `WorkerRequest = { id, input: SimInput }` → `WorkerResponse = { id, ok, result: SimResult }` contract; `runSimulation(SimInput)` returns the p5/p50/p95 `cone`, `riskOfRuin`, `worstMaxDrawdown`. Render the cone + 95th-percentile DD as the "honesty headliner" (direct AlgoTest match, near-free differentiator we already unit-test).
- **Validation:** the posted object is parsed with **zod on the main thread before rendering**. Malformed output → a friendly _"Your `run()` returned something we couldn't read — return `ctx.trades([...])`"_ card, not a crash.
- **Lot-size enforcement:** `ctx.trades()` validates `qty` against the symbol's lot size and rounds/flags violations rather than silently accepting 1-share "lots."

### 10.3 The results panel (inline, reusing the report tiers)

When a run completes, results render **inline below the editor** with an **"Open full report ↗"** to the shared report surface used by the no-code path. BYOC feeds the same `BacktestResult` shape into the same VERDICT → EVIDENCE → DRILL-DOWN components.

```
┌─ RESULTS ───────────────────────────────────────────────  Open full report ↗  ┐
│ THE VERDICT                                                                     │
│  "Net +₹18,240 over 124 trade-days · drawdown controlled"                       │
│  Coverage 81% ⚠   124 trade-days ✓   2024 H1   Costs incl. (Zerodha)            │  ← honesty chips
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │  equity curve  ╱╲___╱╲╱‾‾‾                                                │  │
│  │  drawdown      ‾‾▔▔╲▁▁▁▁  (shared time axis — TradingView convention)     │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│  Total P&L  +₹18,240 (+12.1%)  │ Return/MaxDD 3.4 │ MaxDD −₹5,360 │            │  ← ~6 stats, Composer-tight
│  Expectancy +₹147/day          │ Win% 58%         │ Sharpe 1.27   │            │
│                                                                                 │
│  [ ▾ Evidence ]  monthly heatmap · returns distribution · day-of-week ·         │
│                  expiry-vs-non-expiry · Monte-Carlo drawdown cone (95th %ile)   │  ← reuse src/lib/montecarlo
│  [ ▾ Drill-down ] trade blotter · per-leg P&L + payoff diagram · MAE/MFE        │  ← reuse src/lib/options/payoff.ts
│                                                                                 │
│  ⓘ Backtests use historical data with patchy coverage and assume fills at       │  ← mandatory disclaimer footer
│    recorded prices. Past performance ≠ future results. Beware overfitting.       │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 10.4 Login nudge — only here

Anonymous users get the **full** result rendered. Login gates only **Save / Share / Notify-me**:

```
┌────────────────────────────────────────────────────────────┐
│  Nice — your backtest is done. Want to keep it?             │
│  [ Sign in to save & share ]   results stay local otherwise │
└────────────────────────────────────────────────────────────┘
```

Save/share/bookmark use **optimistic UI** (React 19 `useOptimistic`) — low-risk, reversible — but **never** optimistically assert the backtest _result_ (results are computed, not asserted). These writes are the login-nudge boundary and **must pass `rateLimit("bt:save:"+id, …)`** (§12).

---

## 11. Beginner onboarding into code mode

The blank canvas is the enemy. Layered ramp, gentlest first:

1. **Never a blank file.** `/backtesting/code` always boots the **9:20 short straddle** template (well-covered NIFTY expiry) — first ⌘↵ yields real results in seconds.
2. **"Eject to code" from the no-code wizard** (the strongest ramp): the Review step serializes the visual strategy to runnable, commented Python and lands the user here with _their_ strategy already written (`# This leg came from: ATM CE, Sell, 1 lot`).
3. **First-run coach-marks** (3 dismissible tips, `prefers-reduced-motion`-aware, remembered locally): ① "▶ Run (⌘↵) — runs in your browser" ② "⌗ Data — click a strike to insert the exact query" ③ "Ctrl-Click any `ctx.` word for docs."
4. **Examples tab as a fork library** — five `[Open & Run]` wiring demos (below). **Hard rule:** every example runs end-to-end on the first click, pre-wired to a real expiry that _actually has coverage_, framed as **"wiring demos, not trading advice"** (each carries `# This is a wiring demo, not trading advice`). Ship **5 starters:**

   ```
   ┌─ RUNNABLE EXAMPLES ────────────────────────┐
   │  ▸ 9:20 Short Straddle (expiry day)   ✓ runs│  NIFTY · 27-Jun-2024 · 94% coverage
   │  ▸ ATM CE on Opening-Range Breakout   ✓ runs│  BANKNIFTY · 26-Jun · 91% coverage
   │  ▸ Iron Condor, weekly                ✓ runs│
   │  ▸ Long straddle on event days        ✓ runs│
   │  ▸ Bare-bones "wiring demo" (5 lines) ✓ runs│
   │    [ Open ]   [ Open & Run ]                │
   └────────────────────────────────────────────┘
   ```

   `[Open & Run]` opens the file _and_ immediately fires a run so the user sees the full loop (code → progress → results) in one click.

5. **Cmd+K "Insert snippet"** — `Insert: short straddle`, `Insert: SL/target block`, `Insert: data query for NIFTY ATM` — assemble strategies from working blocks without memorizing the API.
6. **Optional, scoped AI helper** (right-rail `Ask` tab, opt-in, fits the $0-client ethos): "Explain this error" / "Write the data query for me," scoped to our ~12-function API. The platform is fully usable without it.

---

## 12. Abuse & rate-limiting

| Lane                      | Control                        | Mechanism                                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Client run**            | None hard (can't trust client) | Soft per-tab token bucket in `localStorage` (e.g. 30 runs/5min) to discourage accidental hammering; "slow down" toast. Real protection is unnecessary — it's the user's own CPU.                                                                          |
| **HF data fetches**       | Allowlisted host + range reads | CSP `connect-src` + no arbitrary URL on `ctx`. Worst case a user hammers HF from their own IP; HF rate-limits them, not us. Per-slice memoization cuts redundant pulls.                                                                                   |
| **Save / share / notify** | Hard                           | These hit our API and **must** pass `rateLimit("bt:save:"+id, …)` — the existing `src/server/rate-limit.ts` (Upstash → platform-DB fixed-window → in-memory fallback; signature `rateLimit(key, limit=10, windowSec=60)`). Also the login-nudge boundary. |
| **Server tier run**       | Hard                           | `rateLimit("bt:run:"+userId, limitPerPlan, windowSec)` + per-user concurrency = 1 + daily-minutes budget + AST gate (§13).                                                                                                                                |
| **Anon → account abuse**  | Hard at write                  | Anonymous users run unlimited (free, client-side) but cannot persist; the moment they save/share they authenticate and become rate-limited identities.                                                                                                    |

**Login-nudge rule (platform-wide):** never gate the build or the run. The run completes for anonymous users, results render in full, and **only Save / Share / "email me when a server run finishes"** trigger the login modal.

---

## 13. The future server tier (Vercel Sandbox) — deferred, paid, opt-in

Client-side covers the vast majority of runs. The server tier exists only for: (a) very heavy runs that choke a phone, (b) future "scan all strikes / parameter sweep," (c) runs that must continue after the tab closes. **Gated behind login + a paid plan; NOT built in v1.** When built:

- **Isolation:** Vercel Sandbox = ephemeral **Firecracker microVM**, one per run, destroyed after — a _real_ hardware-virtualization boundary we do not invent ourselves. **Deny-all egress** except an explicit allowlist to the HF host + our result-callback endpoint. CPU/memory caps + wall-clock cap; inline runs ≤ **300s**; anything that could exceed 300s is enqueued to **Upstash QStash** and runs async.
- **Static checks BEFORE any server run** (the gate the client lane skips, because server compute is ours):
  1. **AST allowlist scan** (fast): reject `import os/sys/subprocess/socket/ctypes`, `__import__`, `eval`, `exec`, `open(...,'w')`, dunder-escape patterns (`__class__.__bases__…`), any network lib. Whitelist imports to the §7.3 set.
  2. **Size/complexity caps:** max source bytes, max loops / AST-node count (fail fast and legibly).
  3. **Same `ctx` API** as client — identical contract, so code written client-side runs server-side unchanged. Only _where_ DuckDB runs differs.
  4. **Per-user concurrency = 1** server run at a time (queue the rest); per-plan daily-minutes budget.
- **Long-run notify loop (reuse existing infra):**
  ```
  POST /api/backtest/run  (authed, paid)
    → rateLimit("bt:run:"+userId, …)              [src/server/rate-limit.ts]
    → AST static check                             [reject → 400 with line-mapped reason]
    → if est. ≤300s: run inline in Vercel Sandbox; stream progress
         else: enqueue QStash → return {runId, status:"queued"}
    → on completion (after() or QStash callback):
         insert into notifications table           [reuse community v3 infra]
         Resend email "Your NIFTY backtest is ready" [src/server/email.ts]
    → client polls GET /api/backtest/run/:id  (or in-app notification)
  ```
  The notifications table + Resend are **already in the platform** — reuse verbatim. Client-side runs need none of this.

---

## 14. Mobile (PWA, ≥360px)

Code authoring on a phone is secondary; viewing/re-running a shared result is primary.

- **Single-column stack:** action bar pinned bottom, editor full-width, rail collapses into a **modal bottom sheet** (Material spec — scrim `#000`/20%, ≤16:9 initial height, drag handle + tap-out + X) triggered by `⌗ Data` / `ⓘ API` / `⚑ Examples` chips above the editor.
- **Console** becomes a bottom sheet that auto-expands on run.
- **Results render full-width** below; the verdict tier + equity/drawdown are the mobile hero, evidence/drill-down behind tabs.
- Honest framing: _"Editing code is easier on a larger screen — but you can run and view results here."_

```
┌─────────────────────┐        run tapped ↓ modal bottom sheet (scrim #000/20%)
│ ≡  Backtesting   ⌘K │        ┌─────────────────────┐
│ NIFTY · 2024 · 5m ▾ │        │      ▁▁▁ (drag)      │
│ coverage 82% ███░    │        │ ◐ Running…  [Cancel]│
├─────────────────────┤        │ ✓ runtime  ✓ data   │
│ def run(ctx):        │        │ ◐ run(ctx) ▓▓▓░ 64% │
│   spot=ctx.index()   │        │ stops at 0:30       │
│   ...                │        └─────────────────────┘
│ [ Data ▸ ] [ ▸ Run ] │        results slide up as a full-height sheet on completion
└─────────────────────┘
```

---

## 15. Implementation checklist

**New files:**

- `src/app/backtesting/code/page.tsx` — editor shell (public route, no auth gate).
- `src/features/backtesting/code/code-editor.tsx` — Monaco wrapper (dynamic import, curated stub, Ctrl-Click providers, `localStorage` autosave).
- `src/features/backtesting/code/{data-catalog-panel,api-docs-panel,examples-panel}.tsx` — right-rail tabs.
- `src/features/backtesting/code/console.tsx` — Console / Problems / Data-log tabs.
- `src/features/backtesting/backtest.worker.ts` — Pyodide + duckdb-wasm worker, **mirroring the `{id,input}`→`{id,ok,result|error}` contract of `src/lib/montecarlo/montecarlo.worker.ts`**, plus streamed progress messages.
- `src/lib/backtesting/tm_runtime.pyi` + `src/lib/backtesting/tm_runtime.py` — the in-browser `ctx` Python module bootstrapped into Pyodide.
- `src/lib/backtesting/templates/*.py` — the 5 runnable starters.
- `src/lib/backtesting/coverage.ts` — duckdb-wasm footer aggregate → per-strike coverage map.
- `src/lib/backtesting/result-schema.ts` — zod schema for `BacktestResult` + engine (charges/metrics).
- `src/features/backtesting/report/*` — shared report components (consumed by BOTH builder and code mode).

**Reuse (do not rebuild):**

- `src/lib/charges/charges.ts` — `computeCharges(profile, TradeForCharges)`; net P&L. The **only** sanctioned charge math.
- `src/lib/options/payoff.ts` — `PayoffLeg`, `strategyPayoffAt`; per-leg payoff diagram (lot-scaled `qty`).
- `src/lib/montecarlo/{simulate.ts,montecarlo.worker.ts}` — `runSimulation(SimInput): SimResult`; drawdown cone.
- `src/components/shared/{site-header,nav-links,empty-state}.tsx` — public-universe chrome (add `Backtest` nav entry; reuse `EmptyState` for no-data / no-runs states).
- `src/server/{rate-limit.ts,email.ts}` + notifications table — only for the future server tier; client runs need none.

**Decommission:** remove/redirect the placeholder `src/app/app/backtesting/page.tsx` → `/backtesting`.

**Build order (for the team):**

1. **Worker + watchdog skeleton** (`backtest.worker.ts` mirroring `montecarlo.worker.ts`): message protocol, `terminate()` watchdog, fresh-worker respawn — _before_ any Pyodide. Wire a fake `run()` returning canned trades; render results from the dashboard. Proves the kill switch and the Result contract first.
2. **`tm_runtime.py` shim + `ctx` over duckdb-wasm:** `index`/`option`/`coverage` against HF, the `on_missing` nearest-strike logic, row caps. The riskiest + highest-value piece.
3. **Result engine:** charges (`src/lib/charges`) + metrics + Monte-Carlo cone (`montecarlo.worker.ts`) + zod validation.
4. **Editor:** Monaco + `tm_runtime.pyi` stub + Ctrl-Click doc cards + data catalog (coverage heatmap, insert-snippet).
5. **Error translation layer** + the three error states + no-data card.
6. **Cold-start narration + mobile bottom sheet.**
7. **(Deferred) server tier:** AST gate → Vercel Sandbox → `after()`/QStash → notifications + Resend.

---

## 16. Open questions / explicit non-goals

- **Non-goal v1:** arbitrary `pip`/`micropip` installs; non-Python languages; live/paper trading from BYOC; multi-symbol portfolio backtests in one run (scope is one symbol per run, others overridable per-call).
- **Open:** exact heap ceiling per device class (needs profiling on a mid-range Android); whether to ship the soft `Atomics` interrupt in addition to `terminate()`; QStash threshold tuning (start at the 300s `after()` line).

---

## Files referenced (all absolute)

- `c:\Users\raash\Desktop\trading-journal\src\server\rate-limit.ts` — `rateLimit(key, limit=10, windowSec=60)`; Upstash → platform-DB fixed-window → in-memory tiers. Reuse verbatim for save/share + server-tier run limits.
- `c:\Users\raash\Desktop\trading-journal\src\lib\montecarlo\montecarlo.worker.ts` — the Web Worker + `postMessage` pattern (`WorkerRequest = {id, input}` → `WorkerResponse = {id, ok:true, result} | {id, ok:false, error}`) to mirror for `backtest.worker.ts`.
- `c:\Users\raash\Desktop\trading-journal\src\lib\montecarlo\simulate.ts` — `SimInput` / `SimResult` / `runSimulation` (feed it the trade-PnL sequence as R-multiples for the drawdown cone).
- `c:\Users\raash\Desktop\trading-journal\src\lib\options\payoff.ts` — `PayoffLeg`, `strategyPayoffAt`, lot-scaled `qty` convention (NIFTY 75 / BANKNIFTY 35 / SENSEX 20) reused for per-leg payoff in results.
- `c:\Users\raash\Desktop\trading-journal\src\lib\charges\charges.ts` — `computeCharges(profile, t: TradeForCharges)`; STT/GST/stamp/brokerage; the **only** sanctioned charge math, applied by the engine, never by user code.
