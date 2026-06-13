# Segments & Products roadmap (ALL-TRADER-TYPES lane)

TradeMarkk started as an options-first journal. This lane makes it serve **every
Indian trader type** — intraday equity scalpers, delivery/swing investors, F&O
traders, commodity (MCX) and currency (CDS) traders — by modelling the
**Segment × Product** matrix end-to-end and charging each cell correctly.

Everything in this lane is **client-side, paise-correct, no market data, no LLM**,
and works identically across all three storage modes (hosted / BYOD / local).
The journal DB evolves via **additive, idempotent** migrations only.

## The model

- **Segment**: `EQ` (cash equity) · `FUT` · `OPT` (NSE F&O) · `COMM` (MCX
  commodity) · `CDS` (currency derivatives).
- **Product** (holding intent, mirrors the broker order's product column):
  - `MIS` — intraday (square-off same session)
  - `CNC` — delivery (equity, held overnight)
  - `NRML` — carry-forward (derivatives held overnight)
  - `BTST` / `STBT` — buy-today-sell-tomorrow / sell-today-buy-tomorrow (delivery basis)

Legacy trades (logged before this lane) carry `product = null` and are treated
as `MIS` by the charge engine — exactly the pre-v4 single intraday-equity
behaviour, so existing P&L never regresses.

## Charge engine — per (segment, product)

| Segment | Product     | Transaction tax                                                            | Stamp (buy) | DP          | Brokerage                     |
| ------- | ----------- | -------------------------------------------------------------------------- | ----------- | ----------- | ----------------------------- |
| EQ      | MIS         | STT 0.025% **sell** only                                                   | 0.003%      | —           | normal                        |
| EQ      | CNC         | STT 0.1% **both** sides                                                    | 0.015%      | ₹15.34 sell | ₹0 for zero-brokerage brokers |
| EQ      | BTST / STBT | STT 0.1% **both** sides (delivery basis)                                   | 0.015%      | —           | ₹0 for zero-brokerage brokers |
| FUT     | MIS / NRML  | STT 0.05% **sell** (unchanged)                                             | 0.002%      | —           | normal                        |
| OPT     | MIS / NRML  | STT 0.15% **sell** premium (unchanged)                                     | 0.003%      | —           | flat                          |
| COMM    | MIS / NRML  | CTT 0.01% non-agri FUT sell / 0.05% OPT premium · **agri exempt** · NO STT | 0.002%      | —           | normal                        |
| CDS     | MIS / NRML  | **NO STT/CTT** — zero transaction-tax line                                 | 0.002%      | —           | flat                          |

## Backlog

- [x] **SEG-01** Segment×Product model + per-(segment,product) charge engine + trader-type-aware conditional form
- [x] **SEG-02** Charge-engine golden tests for every (segment,product) combo
- [x] **SEG-03** Ingest: parse broker Product column + MCX/CDS segments on import
- [ ] **SEG-04** Backfill product for existing trades + recompute-charges action
- [ ] **SEG-05** Hold-horizon-aware analytics + irrelevant-panel gating (hide expiry-day/entry-hour for multi-day holds; add holding-period buckets)
- [ ] **SEG-06** Trader-type-adaptive dashboard + position-hold calendar
- [ ] **SEG-07** Tax pack v2 — three-way: intraday-speculative / FnO-business / delivery capital-gains (STCG<12m, LTCG>12m)
- [ ] **SEG-08** Onboarding asks trader type + sets defaults + seeds matching sample data
- [ ] **SEG-09** Filters, table & grouping for segment/product/holding-period
- [ ] **SEG-10** Lot-size modelling for derivatives (optional)
- [ ] **SEG-11** Extension capture carries product + exchange (+ MCX/CDS adapters)
- [ ] **SEG-12** Community surfaces respect new segments/products

## Shipped by the loop

- **SEG-01** — journal-DB **v4** migration (`product` column + holding-pattern
  backfill, idempotent), widened `Segment` (EQ/FUT/OPT/COMM/CDS) + new `Product`
  type, per-(segment,product) charge dispatch in `src/lib/charges/charges.ts`,
  extended `ChargeProfile` (delivery STT/stamp, DP charge, commodity CTT,
  zero-brokerage-delivery flag), trader-type-aware trade form (segment selector
  gains Commodity/Currency, a Product selector, strike/CE-PE only for OPT,
  expiry for all derivatives, derived read-only holding period), `product`
  threaded through utils/csv/queries/save-statements/tax. Back-compat: legacy
  no-product trades compute as MIS (no FnO or equity P&L regression).

- **SEG-02** (Shipped 2026-06-13) — exhaustive, hand-verified GOLDEN TABLE
  locking the per-(segment, product) money math. New
  `src/lib/charges/charges.golden.test.ts`: a data-driven matrix of 17 golden
  rows (Zerodha + Upstox + the manual zero profile) asserting the FULL charge
  breakdown — every component line and the total, paise-exact — against values
  computed BY HAND in the test (formula documented per row). Covers EQ+MIS,
  EQ+CNC (DP + both-sides STT), EQ+BTST/STBT (delivery basis, no DP), FUT &
  OPT regression guards (product must not move the charge), COMM future/option/
  agri (CTT 0.01%/0.05%, agri EXEMPT, no STT), CDS (no STT/CTT), plus the
  legacy null-product = MIS back-compat case and paise-rounding boundaries
  (half-up at 0.105 → 0.11). 27 new tests, all green; the engine matched the
  statutory hand computation exactly — NO charge bug found, no `charges.ts`
  change needed.

- **SEG-03** (Shipped 2026-06-13) — broker imports now parse the **Product
  column** and classify **MCX (COMM) / currency (CDS)** segments. `RawFill`
  carries an optional `product` (+ widened `segment`); `csv-brokers.ts` resolves
  each broker's product column (Fyers `Product`, Angel One `Product Type`, Dhan
  `Product`) and `mapProduct()` maps codes → enum: CNC/DELIVERY→CNC,
  MIS/INTRADAY→MIS, NRML/NORMAL/CARRY→NRML, MARGIN/CO/BO/COVER/BRACKET→NRML,
  BTST/STBT preserved; blank/unknown → null so `buildTrade` infers from the
  holding pattern (same-day EQ=MIS, overnight EQ=CNC, derivatives=NRML — matching
  the v4 backfill). Zerodha/Upstox/Groww reports carry no product column → null →
  inferred. `instrument-parse.ts` reclassifies an `MCX:` prefix or a commodity
  base (CRUDEOIL/GOLD/SILVER/NATURALGAS/…) → COMM and the four INR pairs
  (USDINR/EURINR/GBPINR/JPYINR, incl. decimal strikes) or a CDS prefix → CDS,
  preserving strike/CE-PE/expiry (no more EQ/OPT fallback). The import dialog
  preview now shows a per-row `<segment> <product>` chip. **Dedupe ids are
  unchanged** — product is not part of the id parts or the pairing key, so a
  byte-identical re-import produces identical ids (verified). +23 tests
  (instrument COMM/CDS + per-broker product mapping + missing-column inference +
  EQ-CNC delivery-charge cross-check vs the engine + dedupe idempotency).
  Feature e2e (`e2e-seg-ingest`): a crafted Fyers CSV (EQ CNC + EQ MIS + FUT +
  MCX + USDINR) imports with each row's segment/product asserted and delivery >
  intraday charges proven, zero console errors.
