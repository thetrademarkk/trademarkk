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

- [x] **Broker CSV mappers v2** — auto-detect & import Upstox, Angel One, Dhan, Fyers, Groww tradebooks (currently Zerodha-shaped). Pure client-side parsing; dedupe stays idempotent.
- [x] **Insights engine v1 (no-LLM)** — proactive weekly insights computed client-side from the journal: biggest leak (rule × ₹), best/worst entry hour, overtrading detector (trades/day vs win rate), revenge-trade pattern (loss followed within N min), fee drag (charges as % of gross). Dashboard "Insights" card + weekly report section. _Shipped as /app/insights page (sidebar nav): day/hour/payoff/long-short/instruments/streaks/revenge/fee-drag/rule-break findings, n≥5 honesty gate; overtrading detector deferred to the stats pack._
- [x] **Tilt analytics (Edgewonk-style Tiltmeter)** — tilt score per day from emotion tags + rule breaks + position-size spikes; trend chart in Analytics → psychology tab. _Shipped as a "Tilt check" section on /app/insights: four detectors (revenge sizing ≥1.5× usual within 15min of a loss; rushed re-entries ≤0.5× post-win pause; late-session win-rate fade ≥15pp after each day's first 3 trades; overtrading bursts ≥2× own median trades/day), n≥5 on both sides of every comparison, explicit all-clear cards when clean; per-day tilt score + trend chart deferred until emotion-tag adoption grows._
- [x] **Advanced trade filters + saved views** — multi-criteria filter bar (R range, hour, tags, playbook, weekday) with shareable saved views (localStorage), instant client-side. _Shipped as a composable chip bar on /app/trades: symbol/segment/direction/result/setup/tags/R-range/P&L-range/date-range/weekday/rule-adherence criteria, URL-encoded shareable state, named views in tm.saved-views; pure client-side predicate (filter-predicate.ts) over the fetched list. Entry-hour criterion deferred to the stats pack alongside the hour analytics._
- [x] **Share-as-image trade cards** — export any trade/weekly report as a branded PNG (canvas render) for X/WhatsApp; opt-in P&L visibility like community cards. _Shipped as a hand-painted 2D-canvas pipeline (no DOM-to-image dep, rendered on-device, nothing uploaded): generic card model + dark-brand renderer in src/lib/share-card/, trade builder (₹ opt-in → R-multiple → WIN/LOSS → OPEN hero fallbacks, multi-leg badge) and weekly/monthly report builder (win-rate hero, ratio-only stats, green/red-day footnote); ShareImagePanel (Download PNG / Copy image / Web Share) behind Image | Community-post tabs on the trade-detail Share dialog plus a Share image action on /app/reports._
- [ ] **Goals & risk limits** — daily max-loss / max-trades guardrails with banner warnings when breached; weekly P&L / process goals widget with progress.
- [ ] **Price chart on trade detail** — lightweight-charts with free daily/intraday candles (index instruments first), entry/exit/SL markers overlaid.
- [ ] **More statistics pack** — duration buckets, day-of-week heat, win/loss streak distribution, expectancy by confidence rating, R-percentiles. All client-side.
- [ ] **Trade replay lite** — step through a trade's session candle-by-candle (depends on price-chart item) with your entries/exits annotated.
- [ ] **Backtesting v1** — fill the existing coming-soon tab: replay playbook rules against historical index data (depends on price data layer).

## Shipped by the loop

<!-- - [x] YYYY-MM-DD — item — PR #N -->

- [x] 2026-06-12 — Broker CSV mappers v2 — PR #14
- [x] 2026-06-12 — Insights engine v1 (no-LLM) — PR #21
- [x] 2026-06-12 — Tilt analytics (Tilt check on /app/insights) — PR #29
- [x] 2026-06-12 — Advanced trade filters + saved views — PR #40
- [x] 2026-06-13 — Share-as-image trade & report cards — local branch feature/journal-local (no-push regime)
