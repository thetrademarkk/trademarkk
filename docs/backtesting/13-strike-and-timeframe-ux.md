# 13 — Flexible Strike + Arbitrary Timeframe (Builder UX)

## Strike: expose all 4 modes (no schema/engine change)

`strikeSelectorSchema` already ships ATM_OFFSET | PERCENT | PREMIUM | EXACT, and `resolve-strike.ts` honors all four. The ONLY gap is the UI: `strike-ladder.tsx` `MODE_TABS` lists only ATM±/Premium/Exact. Add the **PERCENT** tab.

Refactor `strike-ladder.tsx` → `<StrikeSelector>` (Radix Tabs; lucide Crosshair/Percent/IndianRupee/Hash):

- **ATM ±** — keyboard ladder of real grid rungs (±5), each rung = label/strike/est-premium/CoveragePip; thin rungs (cov≤0.4) dimmed.
- **% off** _(NEW)_ — signed slider/stepper over `-15..15` (PERCENT.pct, schema-clamped). Live preview via `resolveIntentStrike` (already implemented): snapped grid strike + est-premium + CoverageChip. Legend: `+OTM / -ITM`.
- **Premium ₹** — target-₹ input (PREMIUM.target) + optional collapsible band{min,max}.
- **Exact** — raw strike input (EXACT.strike), validated to grid via `validateExactStrike`; inline error `Strike must be a multiple of {STRIKE_STEP}`; wired to the per-step validation gate.

## Coverage honesty — uniform across ALL tabs

Extract two shared primitives and render them under **every** tab (today only ATM± has the pip):

- `<CoverageChip>` — 5-seg pip + confidence tone (good ≥70% / warn 40–69% / bad <40%).
- `<NearestStrikeNote>` — `Served: 24550 (requested 24990)` in **loss-tone** whenever the resolver returns `confidence:'low'` (post-D2). Substitution is **never** silent.
- Footer per tab: _"Premiums & coverage are estimates for selection; strikes resolve to real prices at run time."_

Also add the missing per-leg controls: **trailingStop** and **entryOffsetMin/exitOffsetMin** (in schema, no UI today).

## Timeframe: arbitrary, but GATED behind the resampler

`intervalSchema` is `z.enum(['1m','3m','5m','15m'])` and the engine **never reads interval** — so accepting `7m` today is a silent lie. Sequence:

1. **Phase 1 ships the engine 1m→Nm resampler first** (bucket from 09:15 IST, clamp last bucket to 15:30; entry/exit on the resampled grid, risk always native 1m per Invariant 7; golden-test 7m + 1h).
2. Replace the 4-button control with `<TimeframeControl>`: preset chips (1m/3m/5m/15m/30m/1h/1d) + a **Custom** free-form Input.
3. `src/features/backtest/builder/interval.ts` → `parseInterval(token)`: `Nm` / `Nh`(=N·60m) / `1d`(=375m). Reject `<1m` and `>1d`; **warn but allow** non-session-divisors (ragged last candle). Helper: _"Entries/exits snap to your candle; stop-loss & target are always checked at 1-minute precision."_
4. Widen `intervalSchema` from `z.enum` to a refined string token (`isParsableInterval`), KEEPING the old enum values as a parsing superset (old strategies still parse). **Audit every reader of `market.interval`** (e.g. `run-adapter` clamps to `'1m'`) before the type change.
5. The free-form input only exposes non-1m **once the resampler is live**. Until then, label coarse presets honestly or keep `'1m'`.

## Schema versioning

The interval-token widening + any per-leg field additions ship **with** a `STRATEGY_SCHEMA_VERSION` bump and a back-compat read path, verified against a real persisted v1 record.

## Brand/a11y

Radix Tabs; lucide icons; semantic tokens only (bg/surface/-2, border-accent, text-muted, profit/warning/loss for the pip); keyboard ladder (Arrow/Home/End/0); `tabular-nums font-money` for premium. No emojis.
