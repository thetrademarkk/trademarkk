# Journal Roadmap — North Star: feature-parity+ with paid journals

> **Goal:** match and beat the paid trade journals (TradeZella $29/mo, Edgewonk
> $197/yr, TradesViz, Tradervue) for Indian intraday/FnO traders — free,
> privacy-first, zero-infra. Competitive gap analysis below (researched
> June 2026). Same working rules as COMMUNITY_ROADMAP.md: branch → PR → CI →
> merge (keep branches) → auto-deploy; Playwright-verify every flow; mobile
> audit; DB-optimization first (journal compute stays client-side on the
> user's own DB — zero platform load).

## What competitors have that we lack (researched)

| Competitor | Their edge                                                                          | Our answer                                                                                  |
| ---------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| TradeZella | Zella AI insights, trade replay, backtesting, 500+ broker auto-sync, prop-firm sync | Insights engine (rule-based first), replay-lite, backtesting tab, Indian-broker CSV mappers |
| TradesViz  | 600+ statistics, advanced filtering, AI Q&A                                         | Deeper analytics + saved filters                                                            |
| Edgewonk   | Psychology depth, Tiltmeter emotional tracking                                      | Tilt analytics on our emotion tags                                                          |
| Tradervue  | Free tier, clean equities flow                                                      | Already free — keep simplicity                                                              |

## Backlog (ordered; each = one loop iteration)

> **Constraint update (product owner):** no market-data-dependent features (we
> have no paid live/historical data), no LLM/AI features for now. Everything is
> client-side compute on the user's own journal DB (hosted / BYOD / local
> sql.js). Items needing market data are **DEFERRED** below.

- [x] **Broker CSV mappers v2** — Upstox/Angel One/Dhan/Fyers/Groww auto-detect + dedupe.
- [x] **Insights engine v1 (no-LLM)** — client-side findings on /app/insights.
- [x] **Tilt analytics (Tiltmeter)** — four emotional-spiral detectors on /app/insights.
- [x] **Advanced trade filters + saved views** — composable chip bar, URL-shareable.
- [x] **Share-as-image trade cards** — 2D-canvas trade + report PNGs.
- [x] **Goals & risk limits** — daily/weekly guardrails + breach banners.
- [x] **Indian tax & reporting pack** _(top differentiator — no competitor serves this)_ — FY-grouped F&O turnover statement, speculative vs non-speculative split, STT/stamp/SEBI/GST/brokerage drag breakdown, realised-P&L statement, CSV/Excel export + print-to-PDF. Pure client-side, paise-correct.
- [x] **More statistics pack** — duration buckets, day×time heatmap, streak-length distribution, expectancy-by-confidence, R-percentiles, position-size analysis. All client-side, n>=5 gate per bucket.
- [x] **Psychology/discipline scoring v2** — per-day discipline score + trend, plan-adherence (planned_entry/sl/target deviation), confidence calibration (win% by confidence bin). Fields already in schema; n>=5 gates.
- [x] **Options payoff diagrams + DTE + strategy grouping** — SVG payoff-at-expiry from existing leg rows (no IV/live data), DTE buckets, multi-leg trades collapsed into one strategy row.
- [x] **Monte Carlo simulator** — bootstrap the user's R-distribution + win% into an equity cone (p5/p50/p95), risk-of-ruin, max-drawdown odds. Web Worker, seeded PRNG, n>=30 gate.
- [ ] **Workflow polish** — bulk edit (multi-select tag/playbook), note/journal templates, daily journal prompts, pre-trade plan log (writes planned\_\* fields), keyboard shortcuts. Client-side + localStorage.

### Deferred (need paid market data — revisit if/when a data source is funded)

- [ ] ~~**Price chart on trade detail**~~ — DEFERRED: needs daily/intraday candle data.
- [ ] ~~**Trade replay lite**~~ — DEFERRED: depends on the price-chart data layer.
- [ ] ~~**Backtesting v1**~~ — DEFERRED: needs historical index data; coming-soon tab stays parked.

## Shipped by the loop

<!-- - [x] YYYY-MM-DD - item - PR #N -->

- [x] 2026-06-12 — Broker CSV mappers v2 — PR #14
- [x] 2026-06-12 — Insights engine v1 (no-LLM) — PR #21
- [x] 2026-06-12 — Tilt analytics (Tilt check on /app/insights) — PR #29
- [x] 2026-06-12 — Advanced trade filters + saved views — PR #40
- [x] 2026-06-13 — Share-as-image trade & report cards — consolidated to main (PR-less)
- [x] 2026-06-13 — Goals & risk limits (guardrail banners + weekly goals widget) — consolidated to main (PR-less)
- [x] 2026-06-13 — Indian tax & reporting pack (FY turnover/speculative split/charges/realised-P&L, CSV+Excel+print) — PR #46
- [x] 2026-06-13 — More statistics pack (hold-duration buckets, day×time heatmap, streak-length distribution, expectancy-by-confidence, R-percentiles, position-size; n>=5 gate per bucket) — PR #49
- [x] 2026-06-13 — Psychology/discipline scoring v2 (per-day discipline score 0–100 + recharts trend & 7-day direction, plan-adherence entry-slippage + exit resolution, confidence calibration with over/under-confidence flags; n>=5 honesty gates; demo "Explore with sample data" seed wired) — PR #52
- [x] 2026-06-13 — Options payoff diagrams + DTE + strategy grouping (pure SVG payoff-at-expiry on trade detail for single- & multi-leg OPT trades with max-profit/-loss/breakeven markers + auto-detected strategy label; analytics Options tab with strategy-level grouping and DTE buckets; all closed-form intrinsic-value math, no IV/live data; n>=5 DTE gate; multi-leg demo seed) — PR #57
- [x] 2026-06-13 — Monte Carlo simulator (analytics "Monte Carlo" tab: bootstraps your closed-trade R-distribution into 10k future-trade sequences in a Web Worker with a seeded PRNG → reproducible p5/p25/p50/p75/p95 equity cone in plain SVG, risk-of-ruin vs a user-set drawdown floor, median + worst max-drawdown, probability of finishing net-positive; user-selectable horizon defaulting to your trades/year estimate; n>=30 R-bearing-trade gate with an honest "not enough data" message) — PR #62
