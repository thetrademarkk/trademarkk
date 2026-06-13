# Competitive Teardown & UX References

> Competitive research for the TradeMarkk no-code + bring-your-own-code (BYOC) options backtesting universe (NIFTY / BANKNIFTY / SENSEX). This is a **reference doc**: it distills what to emulate and what to avoid from every relevant builder, code-editor, and results dashboard, then consolidates the winning patterns into adoptable specs. AlgoTest is treated as the gold-standard benchmark and gets the deepest treatment.

**Scope.** Three teardown tracks feed this doc:

1. **No-code builders** — AlgoTest, Sensibull, Opstra, Tradetron, Streak (+ Dhan/Upstox framing).
2. **BYOC code experiences** — QuantConnect, TradingView Pine, Composer.
3. **Results visualization** — TradingView, QuantConnect/LEAN, Composer, AlgoTest, QuantStats/vectorbt, plus generic UX primitives (motion, wizards, progressive disclosure, states, mobile sheets, delight).

**Confidence convention.** Claims are corroborated across 2+ independent sources or the platform's own docs unless flagged `[UNVERIFIED]`. Two such flags are carried through deliberately (see [Flagged claims](#flagged-claims)).

---

## 0. Executive thesis

> **AlgoTest's risk/strike engine + Sensibull's live-payoff joy + Streak's beginner-friendly dropdowns, delivered as a progressive-disclosure wizard with a persistent live preview — and winning outright on honest missing-strike / coverage handling, which none of the five competitors do today.**

| Platform      | Wins at                                                                  | Loses at                                                 | Our move                                                                 |
| ------------- | ------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| **AlgoTest**  | Backtest depth, risk-control + strike-selection granularity, Monte Carlo | Wall-of-fields, jargon, no mobile app                    | Steal the engine; hide it behind progressive disclosure + plain language |
| **Sensibull** | Live payoff + PoP, outlook-grouped templates, clean mobile               | No real historical backtest, no automation               | Steal the visual delight; pair it with a real engine                     |
| **Opstra**    | Instant payoff per add, inline margin, intraday replay                   | Backtest gated ₹1,000/mo, "not beginner-friendly"        | Steal payoff-per-add + margin; keep core backtest free                   |
| **Tradetron** | Composable power, 30+ templates                                          | "No-code" is really a visual DSL — users _"always fail"_ | The anti-pattern. Design against keyword/formula complexity              |
| **Streak**    | Beginner indicator dropdowns, clean trades table                         | Indicator-centric, weak multi-leg payoff                 | Steal the dropdown ergonomics for entry conditions                       |

The single biggest **unmet need** across all five: **honest handling of missing / illiquid strikes.** Our HF dataset is 40–68% patchy (worst on SENSEX). Turning that liability into a first-class, trustworthy signal (`served vs requested strike`, coverage %, confidence chips) is our clearest differentiation.

---

# Part A — No-Code Strategy Builders

## A1. AlgoTest — the benchmark (deepest treatment)

### Overall flow & layout

A single **long, dense, desktop-first form** (not a wizard). Order down the page:

```
┌─────────────────────────────────────────────────────────────┐
│  Underlying:  [BANKNIFTY ▾]   (NIFTY/FINNIFTY/MIDCPNIFTY/     │
│                                SENSEX/BANKEX + ~50 stocks)    │
│  Entry Time: [09:25]   Exit Time: [15:15]                     │
├─────────────────────────────────────────────────────────────┤
│  LEG TABLE                                                    │
│  ┌──┬──────┬─────┬──────────────┬──────┬──────┬───────────┐  │
│  │# │ B/S  │ Lots│ Strike sel.  │ SL   │ TGT  │ Re-entry  │  │
│  ├──┼──────┼─────┼──────────────┼──────┼──────┼───────────┤  │
│  │1 │ SELL │  1  │ ATM Pt  0 CE │ 30%  │ 70%  │ RE ASAP×2 │  │
│  │2 │ SELL │  1  │ ATM Pt  0 PE │ 30%  │ 70%  │ RE ASAP×2 │  │
│  └──┴──────┴─────┴──────────────┴──────┴──────┴───────────┘  │
│  [+ Add leg]                                                  │
├─────────────────────────────────────────────────────────────┤
│  OVERALL (MTM) SETTINGS: SL / Target / Trail / Lock&Trail     │
├─────────────────────────────────────────────────────────────┤
│  ANALYSIS: Payoff · Greeks · Monte Carlo · MTM graph + CSV    │
└─────────────────────────────────────────────────────────────┘
```

Backtest runs over a **start/end date range** across 5+ years of historical NSE data. Strategy "modes" let you **start from a prebuilt template or from scratch**. **No dedicated mobile app** — third-party reviews flag this as the biggest accessibility gap.

### Strike selection — the richest in the market

Per leg, one selector exposes:

| Method                              | Meaning                                                        | Example                     |
| ----------------------------------- | -------------------------------------------------------------- | --------------------------- |
| **ATM Pt**                          | integer strike offset (+ = OTM, − = ITM)                       | spot 20000, `+2` → 20100 CE |
| **ATM %**                           | offset by % from ATM                                           | `+0.5%`                     |
| **Closest Premium**                 | strike whose premium ≈ target                                  | `₹40`                       |
| **Closest Delta**                   | strike whose delta ≈ target (configurable match range)         | `50` → ~0.50 delta          |
| **Premium Range**                   | strike with premium between bounds                             | `₹30–₹50`                   |
| **Direct strike**                   | absolute strike typed in                                       | `20100`                     |
| **Straddle Width / ATM straddle %** | reference = sum of ATM CE+PE; pick strike near a % of straddle | —                           |

### Entry / Exit & schedule

Fixed **Entry Time** + **Exit Time**; **Specific Days of the Week**; **Days from Expiry** (e.g. run only 2 days before expiry).

### Per-leg risk (granular) — two-axis design

SL and Target each in **two units** against **two references**:

```
SL:  [ % | Pts ]  on OPTION premium      TGT: [ % | Pts ]  on OPTION premium
SL UL:[ % | Pts ] on UNDERLYING          TGT UL:[ % | Pts ] on UNDERLYING

Trailing SL  = Trail X / Trail Y   ("move SL by Y when price moves X in favor"), % or Pts
Tgt/SL Ref Price = [ Trigger Price | Traded Price ]
Trail SL to Breakeven  (move SL to breakeven if any leg's SL hits)
```

### Square-off interaction between legs

- **Square Off – Partial** — a leg's SL squares **only that leg**; others continue.
- **Square Off – Complete** — any leg's SL/Target squares off the **whole strategy**.

### Re-entry / re-execute (best-in-class, but jargon-heavy)

| Mode                  | Behaviour                                                                        |
| --------------------- | -------------------------------------------------------------------------------- |
| **RE ASAP**           | re-enter immediately in a new ATM strike at market                               |
| **RE ASAP ↩**         | re-enter in new ATM **and reverse** the position                                 |
| **RE COST / Re-Cost** | re-enter the original leg at the previous entry price (wait for price to return) |
| **RE MOMENTUM**       | wait for a momentum condition before re-entering                                 |
| **Re-Execute**        | Immediate **or** Candle-Closing-Basis (fresh contract selection after SL/target) |

Configurable **Number of Re-Entries** (up to ~5) + **Stop Re-Entry Time**. **Simple Momentum** = enter only after price moves a set points/%.

### Overall (MTM) risk

**Overall Stop Loss**, **Overall Target**, **Overall Trailing SL**, **Lock & Trail** profit-protection (**Lock Min Profit At** + **Trail Min Profit By**), and absolute **Max Loss** (e.g. −5000 → exit at −₹5000 MTM).

### Inline payoff / analysis

Payoff graph · Max Profit · Max Loss · Risk/Reward · Breakeven · **Greeks** (Delta, Theta, Gamma, IV, Vega) · **Monte Carlo across 10,000 price paths** (differentiator) · MTM graph (PNG export) + minute-wise MTM CSV.

### Verdict

**EMULATE**

- Unmatched strike-selection breadth (points / % / premium / delta / direct in one selector).
- Two-axis SL/TGT (option vs underlying, % vs points).
- Partial-vs-Complete square-off logic.
- Named re-entry modes (the _capability_, not the _naming_).
- Backtest + paper + live in one workflow.
- Monte Carlo as an honest robustness signal.

**AVOID**

- Everything visible at once = wall of cryptic fields (`Trail X/Trail Y`, `RE ASAP ↩`, `ATM Pt`).
- No progressive disclosure; jargon without inline explainers.
- No mobile app. Reviews call it "clean" but it rewards experts and punishes newcomers.

---

## A2. Sensibull — best visual / payoff UX, weak backtesting

**Flow.** Outlook-first: pick underlying → **ready-made strategy** or **build your own**; auto-suggests strikes (~1% from spot, rounded to nearest valid strike); tweak **strike / expiry / position size**.

**Templates (broad, outlook-grouped).** Selecting one auto-fills all legs after expiry confirmation:

| Outlook      | Strategies                                                                            |
| ------------ | ------------------------------------------------------------------------------------- |
| **Bullish**  | Long Calendar w/ Calls, Bull Condor, Bull Butterfly, Range Forward + call/put spreads |
| **Bearish**  | Long Calendar w/ Puts, Bear Condor, Bear Butterfly, Risk Reversal                     |
| **Neutral**  | Double Plateau, Batman, Jade Lizard, Reverse Jade Lizard, iron condor, iron butterfly |
| **Volatile** | Strip, Strap, straddle, strangle                                                      |

**Strike selection.** Friendly option chain (per-strike price/OI/Greeks/IV) + dropdown adjust. **No** points/premium/delta auto-selector.

**Inline payoff (the standout).** Auto-calculates **net credit, max profit, max loss, breakeven, and probability of profit live as each leg is added**; a **Payoff Table** toggles graph↔table showing P&L on **Target Day vs Expiry Day**; a **target slider / target selector** (manual entry too) and **Show %** moves. The single most delightful builder interaction in the market.

**Mobile.** Polished iOS/Android; reviews call the UI "nice and fluid with no bugs."

**Verdict.** **EMULATE:** real-time payoff + PoP as you build; outlook-grouped template gallery; target slider + Target-Day/Expiry-Day table; clean mobile. **AVOID:** essentially no historical backtesting (scenario only); no automation/rule-based execution; no programmatic strike auto-selection.

---

## A3. Opstra (Definedge) — powerful, steep, gated

**Flow.** Sequential per leg: stock/index → expiry → strike → CE/PE → Buy/Sell → **Add Position**; payoff chart regenerates on each add.

**Payoff / metrics.** Success-probability %, max profit/loss, breakeven, required **margin**, Greeks tab inside the builder; **options simulator with intraday replay**.

**Verdict.** **EMULATE:** instant payoff on every position add; **margin shown inline**; intraday-replay simulator. **AVOID:** **backtesting gated behind ₹1,000/mo**; free-tier option-chain delays; **explicitly "not beginner-friendly"**; no direct broker execution.

---

## A4. Tradetron — the anti-pattern (avoid)

**Flow.** Organized into **Sets** (entry conditions + repair + positions, plus exit/universal-exit). A **condition builder** opens via "+ Add" / "+ Condition", combined with **AND/OR**, built from a **hierarchical keyword tree** (Position → Symbol → Instrument Name → indicators; LTP, Traded Instrument, `Time()`). Positions need Exchange/Type/List/Product/Expiry/**Quantity**, values constant or **Fx-formula-driven**.

**Strike by premium** uses a **`find strike` keyword** with formula syntax (e.g. `...Set,1,1,1`) — you _write conditional logic_, not pick from a dropdown. SL/target are expressed as conditions (`LTP of futures < 99% of entry price` = 1% SL).

**Verdict.** **POWERFUL:** very composable; 30+ deployable templates. **AVOID (loudly):** the "no-code" builder is really a **visual DSL** — real users report _"unable to create one due to the complex nature of builder"_ and _"always fail"_ on basic strategies; verification needs cryptic notification logs. **This is the failure mode to design against.**

---

## A5. Streak — clean but indicator-centric

**Flow.** Define **Instruments → Entry conditions → Exit conditions (SL/Target) → position sizing → time period**, conditions built from **indicator dropdowns** (e.g. RSI cross + volume) — genuinely no-code. Backtests ~1 year; hypothetical trades listed in a transactions table with entry/exit/P&L.

**Options strikes via "Dynamic Contract."** Pick **Contract Type** (Call/Put) and ATM/ITM/OTM via an **Offset** parameter; works for strategies but **not** scanners.

**Verdict.** **EMULATE:** beginner-friendly indicator dropdowns; free for Zerodha users; clean transactions table. **AVOID:** built around **technical-indicator entries**, not multi-leg payoff design; weaker for structured spreads; no rich inline payoff.

---

## A6. Cross-platform conventions (what users already expect)

- **Strike vocabulary:** ATM/ITM/OTM + offset is universal; **by-points, by-premium, by-delta** are AlgoTest's edge and expected by serious sellers (delta 0.15–0.20, premium ₹40–60 common defaults).
- **Risk defaults seen in the wild** (use as smart-default seeds): per-leg SL 35–50%, target 70–80%, strategy SL ~1.5–2× premium collected, strikes ±200–300 pts from spot.
- **Live payoff while building** (Sensibull/Opstra) is now table-stakes for delight.
- **Outlook-grouped templates** (Sensibull) are the fastest on-ramp.
- **Dhan / Upstox** validate "drag-and-drop / clean visual builder" framing as the marketing expectation.

---

## A7. Recommended builder layout (synthesis)

**Wizard with a persistent live preview — progressive disclosure beats AlgoTest's wall-of-fields.**

```
┌── Stepper: ① Start ─ ② Market ─ ③ Legs ─ ④ Timing ─ ⑤ Risk ─ ⑥ Review ──┐
│                                                          │              │
│   STEP PANEL (one concern at a time)                     │  LIVE RAIL   │
│   ───────────────────────────────                        │  ──────────  │
│   e.g. STEP ③ Legs:                                       │  Payoff graph│
│   ┌───────────────────────────────────────┐             │  ───────────┐│
│   │ Leg 1   [Sell ▾] [1 lot]               │             │   /\        ││
│   │ Strike: (ATM±)(%)(Premium)(Delta)(Exact)│ ← tabs     │  /  \_______││
│   │  ▸ ATM + 0   CE                         │             │ Target-Day  ││
│   │  ⚠ served 24450 (req 24500) · cov 71%   │ ← coverage │ / Expiry tbl││
│   └───────────────────────────────────────┘             │ Target slider││
│   [+ Add leg]                                            │ Max P/L · BE ││
│                                                          │ PoP · margin ││
│                                                          │ Greeks       ││
└──────────────────────────────────────────────────────────┴─────────────┘
```

- **Step 0 — Start.** Template gallery grouped by outlook (Bullish/Bearish/Neutral/Volatile) à la Sensibull, plus "Build from scratch." Selecting a template pre-fills legs.
- **Step 1 — Market.** Index (NIFTY/BANKNIFTY/SENSEX only) · candle interval · date range. Show a **coverage/confidence badge** for the chosen index+range (our differentiator vs all five).
- **Step 2 — Legs.** Card/row per leg. **One strike selector with mode tabs** — `ATM±` / `% offset` / `Premium` / `Delta` / `Exact` (AlgoTest's breadth, one tabbed control, not five raw fields). Buy/Sell toggle + lots (auto lot size: **NIFTY 75 / BANKNIFTY 35 / SENSEX 20**). When the requested strike is missing, surface the **nearest-available strike** with a coverage chip.
- **Step 3 — Timing.** Fixed Entry/Exit time first (indicator-based later) · days of week · days-from-expiry.
- **Step 4 — Risk.** Two clear groups:
  - **Per-leg** — SL/TGT in % or points, on option or underlying; Trail X/Trail Y; Square-off Partial vs Complete.
  - **Overall MTM** — SL / Target / Trailing / Lock-&-Trail / Max Loss.
  - **Re-entry as plain-language presets** — "Re-enter at new ATM", "Re-enter at cost", "Re-enter on momentum" with tooltips — **never** AlgoTest's raw `RE ASAP ↩`.
- **Persistent right rail.** Sensibull-style **live payoff graph + Target-Day/Expiry-Day table + target slider + Show %**, with max P/L, breakeven, **probability of profit**, margin, Greeks — updating as legs change.
- **Results.** Equity curve + MTM (minute-wise export), drawdown, win rate, day/weekday breakdown, **Monte Carlo cone** (reuse `src/lib/montecarlo`), with prominent **overfitting / past-performance** disclaimers.
- **Mobile-first throughout** — the clearest unmet need (AlgoTest has no app; ours is a PWA).

---

# Part B — Bring-Your-Own-Code (BYOC) Experience

> For the client-side Python universe (Pyodide + duckdb-wasm over patchy HF parquet). Confidence flagged per area; load-bearing patterns cited inline in [Sources](#sources).

## B1. The code-editor experience

**QuantConnect Cloud IDE** — most complete reference. Four-zone IDE: left file explorer, center editor (splittable H/V), right rail of collapsible icon-panels (Explorer/Outline, Resources, "Ask Mia"), bottom console with two tabs — **Cloud Terminal** (API messages, errors, logs, Clear Logs) and **Problems** (coding errors). `[HIGH]` Autocomplete is `CTRL+Space`-triggered, shows member type/description/params — but covers only default LEAN class members, **not user-defined objects/classes**, and Python users must add `from AlgorithmImports import *` for it to work at all (recurring forum complaint). `[HIGH]`

> **STEAL:** right-rail-icon + bottom-console layout; a **"Problems" tab separate from runtime "Logs"**.
> **AVOID:** half-working autocomplete is _worse_ than none — it teaches distrust. Ship Monaco with a **curated, hand-authored type stub for _your_ data API** (`load_index()`, `load_option()`, `nearest_strike()`), not a generic Python LSP. Coverage of _your_ API is what matters.

**TradingView Pine Editor** — model for _lightweight_ and _discoverable_. `CTRL+Space` autocomplete; **hover shows syntax reminders**; **`Ctrl/Cmd+Click` on any keyword opens an inline doc popup without leaving the editor**; multi-cursor, search/replace, versioning. Panel floats, docks right (vertical) or bottom (horizontal). `[HIGH]`

> **STEAL:** the **Ctrl-Click-to-docs** pattern is the single best discoverability feature in this teardown and is cheap to replicate — map each API symbol to an inline doc card.

## B2. Making the data API discoverable (highest-leverage area)

This is the **weakest area across all platforms** and the place we can most outclass the benchmark.

| Platform         | Data discovery model                                                                                                                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **QuantConnect** | Prose docs only + `Symbol.Create(...)`; data via `Slice` indexing; 3 universe types. **No in-editor data catalog** — users "piece things together from GitHub examples, forum questions, support tickets." `[MED-HIGH]` This is the central usability failure for semi-technical users. |
| **TradingView**  | Sidesteps discovery — _the chart context is the data_. `close`/`high`/`open` "just work"; `request.security()` pulls other symbols. Missing data is a **first-class language concept**: `na`, `na()`, `fixnan()`, `timeframe_gaps`. `[HIGH]`                                            |
| **Composer**     | No free-text data layer — universe is a **picker** (tickers + metadata); indicators are configured nodes. `[HIGH]`                                                                                                                                                                      |

> **STEAL (highest-leverage prescriptions):**
>
> 1. **Ship a visible data catalog _inside_ the editor**, not in docs — a right-rail "Data" panel listing the 3 indices and, per index, available expiries + a **strike-coverage map**. Since coverage is 40–68% patchy, surface coverage as a first-class signal (strike-availability heatmap + per-query "confidence/coverage %") so users discover what exists _before_ writing a query that returns empty.
> 2. **Make missing-data a language primitive, like Pine's `na`/`fixnan`.** API returns an explicit nearest-available strike with a flag — `requested=22500, served=22550, coverage=0.71` — never a silently empty DataFrame.
> 3. **One-click "insert query snippet"** from the catalog (click `NIFTY 22500 CE 26-Jun` → injects the exact `load_option(...)` call). Collapses the entire "how do I even reference data" barrier.

## B3. Starter examples, templates, boilerplate

- **QuantConnect Algorithm Wizard 2.0** scaffolds the _thinking_: presents five strategy components (Alpha, Universe, Portfolio Construction, Execution, Risk) as swappable premade modules with live-preview, and even renders a **hypothesis template** — _"X leads to, or causes, a change in Y."_ `[HIGH]` Genuinely good (guided, modular, hypothesis-first).
- **Critical counter-lesson:** QuantConnect's _example algorithms_ are widely resented because they "never work without messing with the code" and rarely show profit; staff call them "guidelines... not profitable out-of-the-box." The absence of **minimally-editable, runnable** starter code destroys confidence. `[HIGH]`
- **Composer** leans on "copy and modify hundreds of premade strategies" — fork-a-working-thing beats blank-canvas. `[HIGH]`

> **STEAL:** Offer **runnable-as-is templates** (Pine/Composer model), not aspirational fragments. Ship 3–5 starter Python strategies that run end-to-end on _our_ data the moment they open (e.g. "9:20 short straddle, fixed SL/target", "buy ATM CE on ORB"), **each pre-wired to a real expiry that actually has coverage** so the first run never hits an empty state. Borrow the **hypothesis template** as an optional one-liner. Frame examples as "wiring demos", not profitable.

## B4. The run / output loop

| Platform         | Loop                                                                                                                                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **QuantConnect** | Gold standard for _depth_ — tabs (Overview/Orders/Trades/Insights/Logs/Code/Report), runtime-stats banner, default charts, **order events annotated on the price chart** (gray circle = submit, blue = update, square = cancel, green/red arrow = buy/sell fill), synchronized zoom. `[HIGH]` |
| **Composer**     | Optimizes _iteration speed_ — backtests run **inside the editor with real-time feedback as you change the strategy**, benchmark overlays (S&P/NASDAQ), annualized return, Sharpe, max DD. Tradeoff: refinement is "a lot of trial and error", no sensitivity/optimization tooling. `[MED]`    |
| **Pine**         | Recomputes on the chart instantly on save — the run loop is effectively **invisible**, the ideal.                                                                                                                                                                                             |

> **STEAL:** Aim for **Composer/Pine instant-feedback** _felt_ experience + **QuantConnect-depth** results on demand. A "Run" button that streams a progress state (`loading Python runtime… pulling NIFTY 26-Jun slice…` so Pyodide cold-start feels intentional), then equity + drawdown + trades table, with **order markers on the option/spot chart** (steal QC's arrow/circle vocabulary). Run completes for anonymous users; only **save/share/notify** gates login.

## B5. How errors are surfaced

Where semi-technical users get stranded — research is unusually concrete.

**Pine's error taxonomy** (best-documented failure catalog) `[HIGH]`:

- Biggest trap: **the editor highlights the line where it _detected_ the problem, not the line that _caused_ it — wrong ~30% of the time**, usually 1–2 lines above.
- Top confusers: `Undeclared identifier` (case-sensitivity: `close` ≠ `Close`), `Cannot call X with arguments of type Y` (string `"14"` vs int `14`), `Mismatched input … expecting end of line` (missing bracket on the _previous_ line), `Loop is too long (~500ms)`, `Index out of bounds` (lookback before enough history). ~70% syntax; rest runtime/logical.

**QuantConnect** surfaces a stack trace (error type + location + line) into the Cloud Terminal; color-codes severity (Debug = orange, Error = red); rate-limits debug spam to once/second; ships a **step-through debugger** (line-by-line, inspect variables) + **Mia** agentic debugger. `[HIGH]`

> **STEAL:**
>
> 1. **Translate Python tracebacks, don't dump them.** A raw Pyodide `KeyError`/`IndexError` will terrify the audience. Map common cases to plain-English cards: _"No data for NIFTY 22500 CE on 26-Jun (this strike isn't in the dataset — try 22550, which has 71% coverage)."_ This **is** our no-data empty state and the most important error we'll ship given patchy coverage.
> 2. **Distinguish three states explicitly:** syntax/compile error (before run), runtime error (during), and **valid-run-but-no-data** (the patchy-coverage case). Pine/QC blur the third into generic runtime errors — we make it a distinct, reassuring, actionable state with a suggested nearest strike.
> 3. **Don't trust the line number blindly** — show context lines around the fault; link the offending API symbol to its doc card (reuse Pine's Ctrl-Click idea for errors).

## B6. What makes BYOC approachable vs intimidating

- **The blank canvas is the enemy.** QC's pain = "huge amount of stuff to learn", undiscoverable docs, examples that don't run. Composer's win = fork-and-tweak. **→ Open every session on a runnable template, never an empty file.** `[HIGH]`
- **Data access is the first wall, not the language.** Writing a `for` loop is easy; knowing _what symbol string to type and whether data exists_ is hard. **→ In-editor data catalog + insert-snippet + coverage indicators (our single biggest differentiator).** `[HIGH]`
- **A chat/AI co-pilot lowers the bar.** QuantConnect's **Mia V2** is fully agentic (ideates, writes API code, runs backtests, fixes runtime bugs) explicitly to address that the API "increases the barrier." `[HIGH]` **→ An optional, scoped LLM "explain this error / write the data query" helper fits the $0-client-side ethos.**
- **Honesty about missing data builds trust; silent emptiness destroys it.** Pine earns trust by _naming_ `na`/`fixnan`. **→ Make coverage/confidence visible everywhere.**
- **The run loop must feel instant and safe.** **→ Stream the Pyodide cold-start as intentional progress, then nudge login only at save/share.**

## B7. Constraints to design around (Pyodide + duckdb-wasm) `[HIGH]`

- Optimized Pyodide hits **90–95% of native speed**; compute is fully local → unlimited anonymous users at **$0**. Validates the architecture.
- duckdb-wasm bundles `parquet`/`json`/`icu` and can **range-read/preview parquet from cloud storage without full download** — ideal for HF slices.
- Real limits: **PyArrow is not available in Pyodide**; DataFrames aren't registered into DuckDB (results copied arrow → `list[dict]` → DataFrame, slow at volume); **WASM blob size hurts first-page-load.**

> **→ Lazy-load the Python runtime (don't block the builder UI on it), cache the WASM, push heavy aggregation into DuckDB SQL not pandas, and pull the _narrowest possible_ timestamp+strike slice from HF.**

> **One-paragraph build directive.** Open every session on a runnable template wired to a real, well-covered expiry; put a searchable **data catalog with strike-coverage heatmaps and one-click query-insert** in the right rail; give the editor Monaco + a **curated stub for the ~6 API functions** plus Pine-style Ctrl-Click-to-docs; make **missing data a named, honest state** (`served vs requested`, coverage %) the way Pine names `na`; **translate Python tracebacks into plain-English actionable cards**; stream the Pyodide cold-start as intentional progress; render QuantConnect-grade results (equity, drawdown, trades table, order markers on the price chart) the instant a run finishes — and only _then_ nudge login for save/share/notify.

---

# Part C — Backtest Results Visualization

## C0. The master pattern: VERDICT → EVIDENCE → DRILL-DOWN

Every best-in-class tool follows the same three-tier information hierarchy:

1. **The Verdict (above the fold)** — tight headline stat strip + one hero equity curve. User decides "is this any good?" in **under 3 seconds**.
2. **The Evidence (scroll / primary tabs)** — diagnostic charts that explain _why_: drawdown, distribution, calendar heatmaps, benchmark overlay.
3. **The Drill-down (deferred tabs / expand)** — trade-by-trade blotter, per-leg breakdown, rolling stats, MAE/MFE. Power-user territory, progressively disclosed.

## C1. Per-tool teardown

### TradingView Strategy Tester — gold standard for "headline first, tabs for depth"

Five tabs, deliberately ordered by decreasing audience size:

| Tab                    | Contents                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Overview** (verdict) | **Equity curve** as hero, **drawdown plotted underneath on the same time axis**, optional **buy-&-hold overlay**; compact strip: Total P&L (₹ + %), Max equity DD, Total trades, % profitable, Profit factor |
| **Performance**        | Net/Gross profit, Gross loss, Commission, Buy-&-hold return, Max run-up, Max DD, Max contracts held, Open P&L                                                                                                |
| **Trades analysis**    | Total/win/loss trades, % profitable, Avg P&L, Avg win, Avg loss, **Ratio avg win/loss**, Largest win/loss, **Avg # bars in trades**                                                                          |
| **Risk/perf ratios**   | Sharpe, Sortino, Profit factor, Margin calls                                                                                                                                                                 |
| **List of trades**     | Full blotter — entry/exit price, time, per-trade P&L                                                                                                                                                         |

> **Takeaway:** equity + drawdown on a **shared axis** is canonical; ratios are deliberately **demoted to tab 4** — they are not the verdict.

### QuantConnect / LEAN tear sheet — most complete "institutional" report

**Header band:** Runtime Days, Turnover, **CAGR**, Markets, Trades/day, **Drawdown**, **Probabilistic Sharpe Ratio (PSR)**, Sharpe, Information Ratio, Strategy Capacity.

**Chart sequence (the ordering is itself a recommendation):**

```
1  Returns per Trade — distribution histogram
2  Daily Returns — bar (profit blue / loss gray)
3  Monthly Returns heatmap — green/red, darker = larger
4  Annual Returns — bar + average reference line
5  Cumulative Returns — strategy vs benchmark overlay
6  Asset Allocation — pie (time-weighted)
7  Drawdown / underwater — top 5 DD periods color-highlighted
8  Rolling Beta (6 & 12-mo) + Rolling Sharpe (6 & 12-mo)
9  Leverage + Long/Short exposure over time
10 Crisis-event overlays (strategy vs benchmark in crashes)
```

Two genuinely borrowable ideas:

- **Red/Green "interpretive tests" as pass/fail chips:** _Significant Period_ (5+ yrs), _Significant Trading_ (100+ trades), _Diversified_, _Risk Controlled_ (DD < 10%). A brilliant honesty/quality signal — adapt for Indian options ("Sufficient strike coverage", "Enough trades", "Drawdown controlled").
- **Rolling Sharpe** because _"a single Sharpe is not representative of the entire period"_ — directly serves our overfitting/honesty mandate.

### Composer.trade — cleanest consumer-grade "factsheet"

Closest analog to our no-code audience:

- **Performance chart** with **user-addable benchmarks** (opt-in, not forced).
- **Adjustable time horizon** on the same chart (YTD / 1Y / max).
- Consumer-tight stat set: **Sharpe, Max drawdown, Annualized return, Trailing returns, Calmar, Std dev.**
- **Historical Allocation Graph** — stacked-area "what was I holding when."
- Catalog **sortable by Sharpe / drawdown / annualized return** → these three are the consumer "headline" trio.

> **Takeaway:** for a no-code audience, keep the headline stat count _small_ and make the benchmark **optional**. You don't need 30 metrics on the front page.

### AlgoTest — direct India options benchmark; trade = trading-day, weekday/expiry framing

- Metric set: **Overall Profit, Number of Trades** (a "trade" = a trading day the strategy ran), **Avg Profit/Trade, Win % / Loss %, Avg profit on winners, Avg loss on losers, Max profit/loss in single trade, Max Drawdown + duration, Reward:Risk, Return/Max DD, Expectancy Ratio, Max win/losing streak, Max trades in any drawdown, Slippage.**
- Hero chart = **P&L / equity curve + drawdown curve**; realistic **brokerage + slippage** baked in (we have `src/lib/charges`).
- **Monte Carlo Drawdown:** simulates the trade sequence 10,000× → reports e.g. **95th-percentile drawdown** — more honest than a single historical max DD. (We have `src/lib/montecarlo` in a Web Worker — near-free differentiator.)
- **Optimiser/Portfolio** optimizes on Win%, Avg MTM, Max DD, Return/Max DD, Expectancy — confirms the metrics Indian options traders rank on.
- **Day-wise / weekday** P&L breakdowns — matches how Indian options traders think (expiry-day, weekday effects).

> **Takeaway:** for index options, frame "trade" as a **day/cycle**, lead with **Return/Max DD** and **Expectancy**, and ship the **Monte-Carlo drawdown cone** as the honesty headliner.

### vectorbt + QuantStats — the open-source canon for _which_ charts/metrics exist

Since we run Pyodide client-side, **QuantStats-style output is directly reproducible.**

- **QuantStats metrics:** CAGR, Sharpe, Sortino, Calmar, Omega, Information ratio, **Ulcer index**, expected return, volatility, skew, kurtosis, VaR, max drawdown, **longest DD duration, recovery factor**, win rate, win/loss ratio, profit factor, payoff ratio, **tail ratio, Kelly criterion**, best/worst day-month-year.
- **QuantStats plots:** cumulative returns, log returns, returns-vs-benchmark, **yearly (EOY) returns**, histogram, daily returns, rolling beta/volatility/Sharpe/Sortino, **drawdown periods**, **underwater drawdown**, **monthly returns heatmap**, distribution. The **`snapshot`** function is the canonical "verdict" composite: **equity curve + underwater drawdown + monthly returns in one stacked view** — copy this exact composition for the hero.
- **vectorbt** subplots: orders, trades, **trade PnL (per-trade markers)**, cumulative returns, drawdowns, underwater, gross/net exposure, asset value, cash; stats add Sortino, Calmar, Omega, alpha/beta, tail ratio, VaR, expectancy, best/worst trade, avg trade duration.

### Tradetron — confirms the email/notify pattern

Emails a **detailed report with key metrics on completion**; shows P&L curve + drawdown-% + std dev. **Validates our "nudge login when results ready → Resend email + in-app notification" flow for long server runs.**

### MAE/MFE scatter — power-user "are you cutting winners / holding losers?"

Well-established convention: scatter where each dot is a trade, **green = winner / red = loser**, axes = final P&L vs MAE (or MFE). Reveals whether SL/target placement leaves money on the table. Keep in the **deepest** drill-down tier; needs meaningful sample size to be honest.

## C2. Recommended results screen for TradeMarkk (synthesis)

```
┌──────────────────────── TIER 1 · THE VERDICT (no tabs) ─────────────────────┐
│  "Profitable but drawdown-heavy — Return/MaxDD 1.8, Expectancy ₹420/day"     │
│  CHIPS:  [Strike coverage 82%] [412 trade-days] [2021–2026] [DD controlled]  │
│  HERO (QuantStats `snapshot` composition, shared time axis):                 │
│   ── Equity curve ───────────────────────────────────────────────           │
│   ── Underwater drawdown (directly beneath, shared axis) ────────            │
│   ── Monthly-returns heatmap (third band) ───────────────────────           │
│  STAT STRIP (~6, Composer-tight):                                            │
│   Total P&L (₹+%) · Return/Max DD · Max DD · Expectancy · Win% · Sharpe      │
│  [ ▢ Overlay NIFTY/BANKNIFTY buy-&-hold ]  ← opt-in, not forced              │
├──────────────────────── TIER 2 · THE EVIDENCE (tabs/scroll) ────────────────┤
│  Returns:  monthly heatmap · EOY/annual bar · daily bar · per-trade histogram│
│  Risk:     drawdown periods (top-5 color-highlighted) · rolling Sharpe ·     │
│            Monte-Carlo drawdown cone w/ 95th-pct DD  ← reuse montecarlo      │
│  Calendar (India): day-of-week heatmap · time-of-day heatmap ·               │
│            expiry-vs-non-expiry split  ← out-design AlgoTest                 │
├──────────────────────── TIER 3 · THE DRILL-DOWN (deferred, lazy) ───────────┤
│  Trade blotter (virtualized): entry/exit time, strike, premium, P&L, charges │
│  Per-leg breakdown (reuse src/lib/options/payoff.ts) ← our differentiator    │
│  MAE/MFE scatter (green wins / red losses) for SL-target tuning              │
│  Full metric table: Sortino, Calmar, Omega, Ulcer, tail ratio, skew/kurt,    │
│                      VaR, recovery factor  ← present but tucked away          │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Cross-cutting rules from the teardown:**

- Equity + drawdown **always share the time axis**.
- **Demote ratios** below the equity curve and distribution (TradingView puts them in tab 4).
- **Benchmark is opt-in** (Composer); default = relevant index buy-&-hold.
- **Honesty chips up top** (QuantConnect's red/green tests) — uniquely valuable given patchy-strike data + educational/overfitting mandate.
- **Long runs:** completion → Resend email + in-app notification (Tradetron-validated; infra already exists).

---

# Part D — General UX Patterns (fast, delightful UI)

> Concrete, sourced values mapped to our two surfaces: the **builder wizard** and the **results dashboard**. We already use `motion`/`framer-motion`, Tailwind v4 semantic tokens, Radix.

## D1. Motion & micro-interactions — exact values

Use **spring physics for interactive/gestural motion**, **duration-based easing for entrances/exits**. Springs read as human; linear reads as robotic.

**Easing curves (CSS cubic-bezier, Material Design):**

| Curve                   | Value                            | Use                            |
| ----------------------- | -------------------------------- | ------------------------------ |
| Standard (ease-in-out)  | `cubic-bezier(0.4, 0.0, 0.2, 1)` | default on-screen movement     |
| Decelerate (entering)   | `cubic-bezier(0.0, 0.0, 0.2, 1)` | panels/sheets/modals appearing |
| Accelerate (leaving)    | `cubic-bezier(0.4, 0.0, 1, 1)`   | dismissals                     |
| Sharp (exit-and-return) | `cubic-bezier(0.4, 0.0, 0.6, 1)` | temporary surfaces             |

**Durations:** desktop UI **150–200ms**; mobile baseline **300ms** (entering 225ms / leaving 195ms); large/full-screen **~375ms**; **never exceed ~400ms** for frequent transitions. (WinUI corroborates desktop: Normal 250ms, Fast 167ms, Faster 83ms.) Shorter for exits; longer only for large distance/surface change; asymmetric accel/decel feels more natural than symmetric.

**Spring params (Motion / Framer Motion):**

```ts
// soft default
spring: { damping: 10, mass: 1, stiffness: 1, bounce: 0.25, restSpeed: 0.1, restDelta: 0.01 }
// snappier UI feel (Comeau)
spring: { stiffness: 235, damping: 10, mass: 1 }
// tween defaults
tween: { duration: 0.3 /* single value */ }  // 0.8 for multi-keyframe
```

**Discipline:** store timing functions as **global CSS variables / design tokens**; aim for **~80% of transitions reusing tokens** before any one-off curve (maps onto our Tailwind v4 token system). Always honor `prefers-reduced-motion` (avoid rapid flashes, large scaling, high-contrast transitions; offer a reduce-motion setting).

**Apply to backtesting:** payoff redraws + equity-curve reveals → decelerate curve @ ~200–250ms; leg cards → spring in (`stiffness ~235, damping 10`); MTM SL/target slider thumb → spring. Keep the **running→results** transition under ~375ms so it feels like an _arrival_, not a reload.

## D2. Multi-step wizard / modal flow (the builder)

- **3–4 top-level steps**, not micro-steps (Airbnb listing = 3; job-application = 4 incl. Review). For us: **Setup (index + interval + dates) → Legs → Entry/Exit & Risk → Review/Run.**
- Always include a **dedicated final Review/summary step** before the terminal action.
- **Persistent stepper at top** showing position (`1/4` numbered + labels).
- **Validation:** validate **on "Next"** (per-step), block advancing on invalid input, descriptive inline errors.
- **Back navigation & persistence (non-negotiable):** Back must **never lose data**; clear errors on backward nav; **auto-persist each field to localStorage** on entry, rehydrate on load; let users **jump back to any earlier step** without losing later progress.
- **When right vs wrong:** wizards win for high-stakes/unfamiliar processes where guidance/validation matter; they're _wrong_ for experts who want all inputs at once. **→ Ship the wizard as default, but give power users a single-screen / all-inputs-visible mode (or duplicate-and-tweak from a saved strategy).** This is the novice/expert tension progressive disclosure solves (§D3).
- **Microcopy:** frame steps as a friendly conversation; add "What's next?" supporting panels; goal-oriented questions.

## D3. Progressive disclosure (simple → advanced)

**Core rule (NN/G, Nielsen 1995):** _"Show what is necessary now. Reveal the rest when it becomes relevant."_ Two tiers — primary by default, advanced disclosed — serving novices _and_ experts: hiding advanced settings prevents novice mistakes without "infuriating advanced users" by hiding them indefinitely.

**Three variants:** **step-by-step** (the wizard itself), **conditional** (accordions / "Advanced" toggles), **contextual** (surface options based on prior inputs).

**Concrete mapping:**

- **Strike selection:** default **ATM** (one tap); reveal "by premium" / "by delta" behind an "Advanced strike" disclosure.
- **Risk:** default a simple overall MTM SL/target; disclose per-leg SL/target/trailing + re-entry on demand.
- **Entry/Exit:** fixed-time visible by default; indicator-based behind a later-stage disclosure.

## D4. Loading / skeleton / empty / error states (results dashboard)

**Skeletons over spinners for structured content** — use on tiles, structured lists, **data tables, cards**; appear only a few seconds; resolve once data populates. Measured benefit: **~20–30% lower perceived load time vs spinner-only.**

**Every data component needs three explicit states** — build as reusable primitives (`LoadingSkeleton`, `EmptyState`, `ErrorMessage`, `RetryButton`, `AsyncBoundary`):

- **Loading** — skeleton + shimmer.
- **Empty** — specific headline + illustration/icon + **one prominent CTA**; 2–3 short sentences; never vague "No data" / "Nothing here"; treat as an onboarding moment.
- **Error** — **component-level boundary**, not a full-page blowup.

**Apply to our patchy-data reality (critical):** missing/illiquid strikes are _expected_ → design honest degraded states, e.g. _"Nearest available strike used (requested 24500 → using 24450 — 62% coverage)"_ with a coverage/confidence badge, never silent failure. Connect metrics to action via **color-coded badges, thresholds, and CTAs tied to the data** ("Low coverage — see affected dates"). Use **component-level error boundaries** so one bad options slice degrades a single card, not the whole view.

**Dashboard layout numbers (Stripe/Linear/Grafana-derived):**

| Element              | Value                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar              | **256px** expanded / **64px** collapsed; nav item **36px**; active = 3px left border + 8% accent bg                                                                     |
| KPI cards            | **4–6** above the fold; each = one comparison metric + **one** visual (sparkline OR trend arrow, not both); primary number **28–32px**; `auto-fill, minmax(200px, 1fr)` |
| Grid                 | **12-col, 24px gutters** (chart `span 7` + table `span 5`)                                                                                                              |
| Tables               | rows **48–52px** comfortable / **36–40px** dense; sticky header `z-index:10`; **numbers right-aligned**                                                                 |
| Chart libs (near-$0) | **Recharts ~40KB** or **Chart.js 4 ~65KB** gzipped; avoid ECharts (~400KB+) unless needed                                                                               |

## D5. Mobile bottom-sheets & touch (mobile-first PWA)

**Two types — pick deliberately:**

- **Modal bottom sheet** — alternative to a menu/dialog; sits above content, dims the rest, must be dismissed before interacting beneath. Best for **mobile**. Use for: option-leg editor, strike picker, date-range picker.
- **Standard/persistent** — same elevation as content, stays visible. Use for: a results filter/inspector that coexists with the chart.

**Specs:** modal scrim **`#000` @ 20% opacity**; initial height ≤ the **16:9 keyline**, expandable by swipe-up to full height with **internal scrolling** thereafter; **snap points + drag handle** (handle "is easy to ignore" → also support tap-to-dismiss + explicit close); dismissal = swipe down / tap X / Android back / (modal) tap outside; a given sheet must **behave identically everywhere**; on larger screens prefer dialogs/menus. **Accessibility:** ensure keyboard/AT dismissal; announce open/close.

## D6. "Delight" details

**Speed _is_ the delight (Linear's thesis).** Linear loads in **<200ms**, view transitions **<100ms**, issue updates in "a few milliseconds" via a **local browser DB (IndexedDB) + optimistic writes + sync engine** — eliminating network latency. _"Linear's speed is a design decision, not just an engineering one."_

> **Direct parallel:** with **duckdb-wasm + Pyodide client-side** we already have the local-compute substrate — lean in. Cache fetched HF slices locally, render partial results progressively, never block the UI on a server round-trip for anonymous runs.

**Optimistic UI** — update immediately assuming success; reconcile/rollback on failure. Safe for **low-risk, reversible** actions (likes/saves/toggles). Every optimistic action needs explicit rollback + user notification. React 19 `useOptimistic` is idiomatic. **Apply to:** saving/sharing a backtest, bookmarking a strategy, toggling a leg — **not** the backtest result itself (results are computed, not asserted).

**Command palette (Cmd/Ctrl+K)** — searchable popup of commands/destinations/recent items, keyboard-first. Group results into buckets (commands vs pages vs recent), fuzzy search, logical focus order, **announce state via ARIA**. **Apply to:** "New backtest", "Switch index → BANKNIFTY", jump to saved strategy, "Compare runs", "Export." Pairs with the power-user escape hatch from §D2.

**Keyboard shortcuts** — surface in tooltips and the palette.

**TradingView-style toolbar discipline (we render charts):** organize tools into a small set of **meaningful categories where every tool has a role** (TV: 8 grouped drawing categories + top toolbar for symbol/indicator/resolution + left rail for tools). Minimalist, drag-and-drop, double-click-to-configure. Apply to payoff/equity chart controls.

## D7. Priority cheat-sheet for implementation

| Decision        | Concrete value                                                                     |
| --------------- | ---------------------------------------------------------------------------------- |
| Default easing  | `cubic-bezier(0.4,0,0.2,1)`; enter `(0,0,0.2,1)`, exit `(0.4,0,1,1)`               |
| Durations       | desktop 150–200ms, mobile 300ms, large 375ms, **cap 400ms**                        |
| Spring (snappy) | `stiffness:235, damping:10, mass:1`                                                |
| Wizard          | 3–4 steps + Review; validate on Next; localStorage autosave; lossless Back         |
| Disclosure      | ATM strike / simple MTM risk / fixed-time = default; rest behind "Advanced"        |
| Sidebar         | 256px / 64px collapsed; 4–6 KPI cards; 12-col grid, 24px gutters                   |
| Skeletons       | tables/cards only; ~20–30% perceived-load win vs spinner                           |
| Empty state     | specific headline + illustration + 1 CTA; **surface coverage/confidence honestly** |
| Bottom sheet    | modal scrim `#000`/20%; ≤16:9 initial height; drag handle + tap-out + X            |
| Delight         | client-side compute (<100ms feel), Cmd+K palette, optimistic save/share only       |

---

# Consolidated: Best UX patterns to adopt

| #   | Pattern                                                                                            | Source(s)                           | Where we apply it                          |
| --- | -------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------ |
| 1   | **Tabbed single strike selector** (ATM± / % / Premium / Delta / Exact)                             | AlgoTest                            | Builder Step 2 — Legs                      |
| 2   | **Two-axis SL/TGT** (% vs Pts, option vs underlying)                                               | AlgoTest                            | Builder Step 4 — Per-leg Risk              |
| 3   | **Square-off Partial vs Complete**                                                                 | AlgoTest                            | Builder Step 4 — Per-leg Risk              |
| 4   | **Re-entry as plain-language presets** (not `RE ASAP ↩`)                                           | AlgoTest (inverted)                 | Builder Step 4 — Risk                      |
| 5   | **Live payoff + PoP + Target-Day/Expiry-Day table + target slider**                                | Sensibull                           | Builder persistent right rail              |
| 6   | **Outlook-grouped template gallery** (Bullish/Bearish/Neutral/Volatile)                            | Sensibull                           | Builder Step 0 — Start                     |
| 7   | **Inline margin + payoff-per-add**                                                                 | Opstra                              | Builder right rail                         |
| 8   | **Indicator dropdowns for entry conditions**                                                       | Streak                              | Builder Step 3 (indicator phase)           |
| 9   | **Avoid keyword/formula DSL** ("no-code" must be truly no-code)                                    | Tradetron (anti-pattern)            | Whole builder                              |
| 10  | **In-editor data catalog + strike-coverage heatmap + one-click query insert**                      | (gap none fill) + Composer picker   | BYOC right rail                            |
| 11  | **Ctrl/Cmd+Click → inline doc card**                                                               | TradingView Pine                    | BYOC editor                                |
| 12  | **Curated API type stub** (not generic LSP)                                                        | QuantConnect (inverted)             | BYOC editor                                |
| 13  | **Missing data as a named, honest primitive** (`served vs requested`, coverage %)                  | Pine `na`/`fixnan`                  | Whole platform                             |
| 14  | **Runnable-as-is starter templates** wired to covered expiries                                     | Composer / Pine                     | BYOC + builder                             |
| 15  | **Translate tracebacks → plain-English cards**; distinguish 3 error states                         | Pine + QuantConnect                 | BYOC run loop                              |
| 16  | **Optional scoped AI co-pilot** ("explain error / write query")                                    | QuantConnect Mia                    | BYOC editor                                |
| 17  | **VERDICT → EVIDENCE → DRILL-DOWN** tiering                                                        | all results tools                   | Results screen                             |
| 18  | **Equity + underwater drawdown on shared time axis**                                               | TradingView / QuantStats `snapshot` | Results Tier 1 hero                        |
| 19  | **Demote ratios below equity + distribution**                                                      | TradingView (tab 4)                 | Results layout                             |
| 20  | **Red/green honesty/quality chips** (coverage, trade count, DD)                                    | QuantConnect interpretive tests     | Results Tier 1                             |
| 21  | **Monte-Carlo drawdown cone (95th-pct DD)**                                                        | AlgoTest                            | Results Tier 2 — Risk (reuse `montecarlo`) |
| 22  | **Rolling Sharpe** ("a single Sharpe lies")                                                        | QuantConnect / QuantStats           | Results Tier 2 — Risk                      |
| 23  | **Opt-in benchmark overlay** (default index buy-&-hold)                                            | Composer                            | Results Tier 1                             |
| 24  | **India calendar heatmaps** (day-of-week, time-of-day, expiry split)                               | AlgoTest + our edge                 | Results Tier 2 — Calendar                  |
| 25  | **Order markers on price chart** (arrow/circle vocabulary)                                         | QuantConnect                        | Results + BYOC run output                  |
| 26  | **MAE/MFE scatter** (green wins / red losses)                                                      | QuantifiedStrategies / TradesViz    | Results Tier 3                             |
| 27  | **Per-leg payoff breakdown**                                                                       | (gap in Western tools)              | Results Tier 3 (reuse `payoff.ts`)         |
| 28  | **Completion → Resend email + in-app notification**                                                | Tradetron                           | Long server runs                           |
| 29  | **3–4 step wizard + Review; validate on Next; lossless Back; localStorage autosave**               | Smashing / NN/G                     | Builder shell                              |
| 30  | **Progressive disclosure** (simple default, "Advanced" reveal)                                     | NN/G                                | Builder + BYOC                             |
| 31  | **Spring micro-interactions + tokenized easing**; cap 400ms; honor `prefers-reduced-motion`        | Material / Motion.dev               | Whole UI                                   |
| 32  | **Skeletons (not spinners) for tables/cards**; 3 explicit states; component-level error boundaries | Carbon / NN/G                       | Results dashboard                          |
| 33  | **Modal bottom sheets** (scrim `#000`/20%, ≤16:9, drag handle + tap-out + X)                       | Material / NN/G                     | Mobile builder                             |
| 34  | **Client-side speed as delight** (cache HF slices, progressive render, <100ms feel)                | Linear                              | Whole platform                             |
| 35  | **Cmd+K command palette** + power-user single-screen escape hatch                                  | Linear / Figma                      | Whole platform                             |
| 36  | **Optimistic UI for save/share/bookmark only** (not results)                                       | LogRocket / Wisp                    | Save/share actions                         |

---

## Flagged claims

1. **QuantConnect Mia "75% working-code vs OpenAI/Claude"** — appears only in a third-party search summary, **not** in QuantConnect's official announcement. `[UNVERIFIED]` — do not cite as fact.
2. **QuantConnect typical backtest run _duration_** — no source stated it; runtime depends on data volume + strategy complexity. `[UNKNOWN]`

_Verification note:_ across the source set, several pages returned HTTP 403 / truncation (NN/G bottom-sheet & animation-duration, LogRocket skeleton & optimistic, Carbon loading, Material m3 bottom-sheet, an NN/G animation-duration page). Each blocked claim was corroborated from at least one alternative accessible source (Material m1 for sheets/easing; artofstyleframe + Carbon-via-search for skeletons; Wisp/iClick for optimistic UI), so no cited number rests on a single unverified source.

---

## Sources

### No-code builders

- AlgoTest docs: [leg-builder](https://docs.algotest.in/features/leg-builder/) · [strategy-builder](https://docs.algotest.in/strategy-builder/) · [setting-up](https://docs.algotest.in/strategy-builder/setting-up/) · [basic-strategy-creation](https://docs.algotest.in/clicktrade/strategy-builder/creating-managing-strategies/basic-strategy-creation/) · [overall-strategy-settings](https://docs.algotest.in/features/overall-strategy-settings/) · [broker-level-settings](https://docs.algotest.in/features/broker-level-settings/) · [legwise-settings](https://docs.algotest.in/features/legwise-settings/) · [backtest](https://docs.algotest.in/backtest/)
- AlgoTest blog: [definition-of-terms](https://algotest.in/blog/definition-of-terms-used-in-backtesting-platform/) · [how-to-backtest](https://algotest.in/blog/how-to-backtest-options-trading-strategies-with-examples/) · [optimize-sales](https://algotest.in/blog/optimize-sales-with-algotest-option-strategy-builder/) · [buying-strategies](https://algotest.in/blog/buying-strategies-with-algotest-option-strategy-builder/) · [best-strategy-builders](https://algotest.in/blog/best-strategy-builders-for-options-trading-in-india/)
- StockMock/AlgoTest field reference: [myalgomate](https://www.myalgomate.com/product/stockmock-algotest-strategy/) · reviews: [TradersUnited](https://tradersunited.org/blog/algotest-review-trading-platform) · [Capterra](https://www.capterra.com/p/10041672/AlgoTest/)
- Sensibull: [site](https://sensibull.com/) · [Medium walkthrough](https://anup-khandelwal.medium.com/sensibull-option-strategy-builder-unleashing-the-potential-of-customized-trading-strategies-4c7a5c11f011) · [14 new strategies](https://blog.sensibull.com/2022/11/30/new-strategies-in-strategy-builder/) · [payoff-table blog](https://blog.sensibull.com/2023/07/06/payoff-table-on-strategy-builder-analyse-widgets/) · [Google Play](https://play.google.com/store/apps/details?id=com.sensibull.mobile&hl=en_IN) · [DematDive](https://dematdive.com/sensibull-app-review/)
- Opstra: [profiletraders walkthrough](https://www.profiletraders.in/post/how-to-test-an-options-trading-strategy-using-opstra-definedge-analytics) · [Definedge](https://www.definedgesecurities.com/products/opstra/) · [strategy-builder](https://opstra.definedge.com/strategy-builder)
- Tradetron: [step-by-step tutorial](https://tradingtuitions.com/how-to-create-a-strategy-in-tradetron-step-by-step-tutorial/) · [Create Strategy help](https://help.tradetron.tech/en/category/create-strategy-1lq2eo1/) · [Strike Fx by premium](https://help.tradetron.tech/en/article/how-to-select-a-strike-based-on-option-premium-value-in-strike-fx-s2hd28/) · [building-without-coding](https://tradetron.tech/blog/building-automated-trading-strategies-without-coding-a-step-by-step-guide)
- Streak: [strategies help](https://help.streak.tech/strategies/) · [Dynamic Contract](https://help.streak.tech/dynamic_contract/) · [Angel One Streak](https://www.angelone.in/streak)
- Comparisons: [how2shout 8 best](https://www.how2shout.com/tools/8-best-options-backtesting-websites-in-india-for-nse-and-bse.html) · [gettogetherfinance](https://www.gettogetherfinance.com/blog/strategy-builders-for-options-trading/) · [Opstra-vs-Sensibull](https://algotest.in/blog/opstra-vs-sensibull/) · [Streak-vs-Tradetron](https://algotest.in/blog/streak-vs-tradetron/)

### BYOC code experiences

- QuantConnect IDE: [docs/ide](https://www.quantconnect.com/docs/v2/cloud-platform/projects/ide) · autocomplete limits (forum): [18118](https://www.quantconnect.com/forum/discussion/18118/) · [10056](https://www.quantconnect.com/forum/discussion/10056/)
- QuantConnect Algorithm Wizard 2.0: [blog/algorithm-lab-2-0](https://www.quantconnect.com/blog/algorithm-lab-2-0/) · "examples never work" (forum): [9012](https://www.quantconnect.com/forum/discussion/9012/)
- QuantConnect results / debugging / Mia: [results](https://www.quantconnect.com/docs/v2/cloud-platform/backtesting/results) · [debugging](https://www.quantconnect.com/docs/v2/cloud-platform/projects/debugging) · [Mia V2 announcement](https://www.quantconnect.com/announcements/19846/your-ai-quant-developer/) · learning-curve criticism: [algotrading101](https://algotrading101.com/learn/quantconnect-guide/) · [newyorkcityservers](https://newyorkcityservers.com/blog/quantconnect-review)
- TradingView Pine Editor: [how-to-work-with-pine-editor](https://www.tradingview.com/support/solutions/43000763320-how-to-work-with-pine-editor/) · errors: [betashorts Medium](https://medium.com/@betashorts1998/pine-script-errors-explained-the-10-messages-that-confuse-every-beginner-38c2dcd883bb) · [quantvps](https://www.quantvps.com/blog/common-pine-script-errors-and-how-to-fix-them-fast) · `na`/`fixnan`: [pineify](https://pineify.app/resources/blog/understanding-the-na-function-in-pine-script) · [tradingcode](https://www.tradingcode.net/tradingview/time-frame-gaps-setting/)
- Composer UX: [daytradereview](https://daytradereview.com/composer-trade-review/) · symphony structure: [symphony_parser](https://github.com/androslee/compose_symphony_parser)
- Pyodide / duckdb-wasm: [duckdb.org/2024/10/02/pyodide](https://duckdb.org/2024/10/02/pyodide) · [motherduck](https://motherduck.com/blog/duckdb-wasm-in-browser/) · [glinteco 2026 guide](https://glinteco.com/en/post/beyond-the-server-running-high-performance-python-in-the-browser-with-pyodide-and-webassembly-2026-guide/)

### Results visualization

- TradingView Strategy Report: [official](https://www.tradingview.com/support/solutions/43000764138-tradingview-strategy-report-how-to-start/) · [tv-hub guide](https://www.tv-hub.org/guide/tradingview-backtesting)
- QuantConnect report: [docs/report](https://www.quantconnect.com/docs/v2/cloud-platform/backtesting/report) · [LEAN tear sheet blog](https://www.quantconnect.com/blog/leans-tear-sheet-the-lean-report-creator/)
- Composer: [symphony DB](https://www.composer.trade/symphony) · [factsheet example](https://www.composer.trade/trading-strategies/simplified-way-too-long-backtest-switchboard-k-1-free-tQOWlndAePv8FMJtPXY0)
- AlgoTest results: [backtesting-results](https://docs.algotest.in/Time-Based-Algo-Trading/Backtest-Analysis-and-Pricing/backtesting-results/) · [Monte Carlo DD](https://docs.algotest.in/backtest/monte-carlo-drawdown/) · [optimiser](https://docs.algotest.in/optimiser/)
- QuantStats / vectorbt: [quantstats](https://github.com/ranaroussi/quantstats) · [vectorbt portfolio](https://vectorbt.dev/api/portfolio/base/) · [qs_adapter](https://vectorbt.dev/api/returns/qs_adapter/)
- Tradetron backtest: [backtest](https://tradetron.tech/backtest)
- MAE/MFE: [QuantifiedStrategies](https://www.quantifiedstrategies.com/maximum-adverse-excursion-and-maximum-favorable-excursion/) · [TradesViz](https://www.tradesviz.com/blog/mfe-mae-duration/) · [Tradervue](https://help.tradervue.com/article/3440-mfe-and-mae-calculations)

### General UX patterns

- Motion & easing: [Comeau — springs/linear()](https://www.joshwcomeau.com/animation/linear-timing-function/) · [Motion.dev — React transitions](https://motion.dev/docs/react-transitions) · [Material — Duration & easing](https://m1.material.io/motion/duration-easing.html) · [Material — Speed](https://m2.material.io/design/motion/speed.html) · [Primotech](https://primotech.com/ui-ux-evolution-2026-why-micro-interactions-and-motion-matter-more-than-ever/) · [trydemotion](https://trydemotion.com/blog/motion-design-principles-animation)
- Wizards: [Smashing](https://www.smashingmagazine.com/2024/12/creating-effective-multistep-form-better-user-experience/) · [Lollypop](https://lollypop.design/blog/2026/january/wizard-ui-design/) · [Webstacks](https://www.webstacks.com/blog/multi-step-form) · [Reform](https://www.reform.app/blog/10-best-practices-for-multi-step-form-navigation) · [Educative](https://www.educative.io/courses/learn-react/multi-step-and-wizard-forms)
- Progressive disclosure: [NN/G](https://www.nngroup.com/articles/progressive-disclosure/) · [UXPin](https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/) · [IxDF](https://ixdf.org/literature/topics/progressive-disclosure) · [4 variants](https://medium.com/@mahfuzbd86/understanding-the-4-key-variants-of-progressive-disclosure-in-ux-design-7513c5360cb4) · [ui-patterns](https://ui-patterns.com/patterns/ProgressiveDisclosure)
- States & dashboards: [Eleken — empty state](https://www.eleken.co/blog-posts/empty-state-ux) · [Vibe Coder](https://blog.vibecoder.me/empty-states-loading-states-error-states) · [ndlab](https://ndlab.blog/posts/part2-4-ux-state-loading-error-empty) · [artofstyleframe — dashboard patterns](https://artofstyleframe.com/blog/dashboard-design-patterns-web-apps/) · [LogRocket — loading skeleton](https://blog.logrocket.com/handling-react-loading-states-react-loading-skeleton/) · [20 dashboard principles](https://medium.com/@allclonescript/20-best-dashboard-ui-ux-design-principles-you-need-in-2025-30b661f2f795)
- Bottom sheets / mobile: [Material — bottom sheets](https://m1.material.io/components/bottom-sheets.html) · [NN/G — bottom sheet](https://www.nngroup.com/articles/bottom-sheet/) · [Mobbin](https://mobbin.com/glossary/bottom-sheet) · [TestParty](https://testparty.ai/blog/mobile-accessibility-patterns)
- Delight: [1023jack — Linear](https://1023jack.com/general/how-s-linear-so-fast-a-technical-breakdown/) · [performance.dev — Linear](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown) · [TechPlanet — Linear](https://techplanet.today/post/how-linear-achieves-blazing-fast-performance-a-deep-dive-into-modern-web-app-architecture) · [LogRocket — useOptimistic](https://blog.logrocket.com/understanding-optimistic-ui-react-useoptimistic-hook/) · [Wisp — optimistic UI](https://www.wisp.blog/glossary/optimistic-ui) · [iClick — optimistic UI](https://iclickonline.co.nz/optimistic-ui-in-application-development/) · [uxpatterns.dev — command palette](https://uxpatterns.dev/patterns/advanced/command-palette) · [Mobbin — command palette](https://mobbin.com/glossary/command-palette) · [UX Glossary — command palette](https://www.uxglossary.com/glossary/command-palette) · [Medium — keyboard shortcuts](https://medium.com/design-bootcamp/the-art-of-keyboard-shortcuts-designing-for-speed-and-efficiency-9afd717fc7ed) · [TradingView — drawing tools](https://www.tradingview.com/support/solutions/43000703396-drawing-tools-available-on-tradingview/) · [TradingView — toolbars docs](https://www.tradingview.com/charting-library-docs/latest/ui_elements/Toolbars/)
