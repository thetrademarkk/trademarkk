# TradeMark Chrome Extension — Roadmap

> Log trades and tick your daily rules **without leaving your broker's web page**
> (Zerodha Kite, Upstox, Groww, Dhan, Fyers). The extension is a thin companion
> to the journal — no community features, only the highest-value essentials.

## Vision

The moment a trade closes is the moment journaling honesty peaks — and the
moment most traders are furthest from their journal. The extension puts a
TradeMark side panel directly beside the broker tab so logging a trade takes
under ten seconds and the day's rules stay in view all session. Everything the
extension writes lands in the user's own journal database, byte-identical to a
trade logged from the web app.

## Architecture decision record (v1)

### UI surface: `chrome.sidePanel`, popup as compatibility fallback

- **Decision:** Manifest V3, Chrome 114+ `chrome.sidePanel` opened from the
  toolbar icon via `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`
  — the pattern Chrome's own extension team recommends. The panel persists
  beside the broker tab while the user trades, which is exactly the "log while
  trading" workflow. On Chromium browsers without the sidePanel API the
  service worker detects its absence and wires the same UI as an action popup
  (`chrome.action.setPopup`) instead. We deliberately do **not** declare a
  `default_popup` in the manifest: Chrome's docs leave the
  popup-vs-`openPanelOnActionClick` precedence undefined, so the fallback is
  resolved at runtime where it is deterministic.
- **Stack:** React 19 + TypeScript, built with Vite into `extension/dist`.
  Plain CSS using the app's design tokens copied from `src/styles/globals.css`
  (carbon dark default, light via `prefers-color-scheme`). lucide-react static
  SVG icons only. Build/test deps live in the **root** `package.json`
  (single lockfile keeps CI to one `npm install`; scripts `ext:build`,
  `ext:typecheck` are wired into root scripts and CI).

### Auth: the app's own cookie session, never tokens in the extension

- **Decision:** the user signs in once on the web app (the panel's signed-out
  state opens `<appUrl>/app/onboarding` in a tab and polls until the session
  appears). All API calls from the panel use `fetch(..., { credentials:
"include" })`. Since Chrome 79, extension-initiated requests to origins the
  extension holds `host_permissions` for are treated as **same-site**, so the
  Better Auth `SameSite=Lax` session cookie is attached — no token storage, no
  OAuth dance, nothing sensitive persisted by the extension.
- **Pinned identity:** the manifest carries a fixed `key` (public key), which
  pins the extension ID to `ibfnimbkdoiafemjonbnnjhnojodanej` even when
  load-unpacked. The server allows exactly
  `chrome-extension://ibfnimbkdoiafemjonbnnjhnojodanej` (overridable via the
  `EXTENSION_ORIGIN` env var for forks) in `isAllowedOrigin` and Better Auth
  `trustedOrigins`. **Never** `chrome-extension://*`. Session + rate limits
  still apply on every endpoint; the origin pin is CSRF defense-in-depth, not
  authentication.
- **Threat model notes:** a malicious _website_ cannot forge a
  `chrome-extension://` Origin header. A malicious _extension_ would need both
  the user to install it **and** host permissions on the app origin — at which
  point it could act on the page directly; the origin pin adds no new exposure.
  The manifest `key` is a public key (safe to commit); the private half
  (`extension/key.pem`, gitignored) is only needed for future Web Store
  packaging.

### Data: reuse the token-vending flow — zero new write endpoints

- **Decision (option a):** the extension connects to the user's own Turso
  database exactly like the web client. Hosted mode: `POST /api/db/token`
  (session cookie) → `{ url, token }` → `@libsql/client/web` over HTTPS.
  BYOD mode: the user pastes the same Turso URL + token they use in the app
  (stored in `chrome.storage.local`). No journal data ever transits the
  platform server.
- **Identical writes:** the web client's statement builder was extracted into
  the pure module `src/features/trades/save-statements.ts`; both the web form
  and the extension call it, so ids (ULIDs), fills, charges (paise-rounded),
  status derivation and timestamps are byte-identical. Rule check-offs use the
  same `INSERT ... ON CONFLICT(date, rule_id)` SQL as the web dashboard.
- **Migrations:** the extension never migrates databases. It checks
  `schema_migrations` and shows "open the web app once to update your
  database" if the schema is older than what it needs.
- **Local mode (sql.js):** the journal lives inside the web app's IndexedDB —
  unreachable from an extension by design. The panel shows an honest
  "extension needs hosted or BYOD mode" state with a link to switch modes.

### Server changes (kept minimal, audit-lane standards)

| Change                                       | File                         | Why                                 |
| -------------------------------------------- | ---------------------------- | ----------------------------------- |
| `EXTENSION_ORIGIN` env (default = pinned ID) | `src/server/env.ts`          | one knob for forks/self-hosters     |
| Allow the pinned extension origin            | `src/server/origin-check.ts` | `POST /api/db/token` from the panel |
| Trust the pinned origin                      | `src/server/auth.ts`         | sign-out from the panel             |

## Architecture decision record (v2) — broker-page capture

### Opt-in content scripts, registered dynamically

- **Decision:** no broker host is requested at install. The "Broker capture"
  section in the panel settings asks per broker; enabling runs
  `chrome.permissions.request` (Chrome's own consent prompt — declining is
  always honored, the toggle just stays off) and then registers the broker's
  content script via `chrome.scripting.registerContentScripts`
  (`persistAcrossSessions: true`). Disabling unregisters the script **and
  returns the host permission**. Chrome's registration list is the single
  source of truth for the toggle — no shadow "enabled" flag to drift.
- The manifest gains only the `scripting` permission; broker origins stay
  under `optional_host_permissions`.

### Per-broker adapters with versioned, layered selectors

- **Interface:** `extension/src/brokers/types.ts` —
  `BrokerCaptureAdapter { id, label, version, originPattern, contentScript, findOrderPanel(), readOrder() }`,
  registered in `extension/src/brokers/index.ts`. Adding Upstox/Groww later is
  a new adapter file + content entry + build pass; the settings toggle,
  permission flow and panel prefill pick new adapters up from the registry.
- **Kite (v1 selectors):** the order dialog is `.order-window` carrying a
  `buy`/`sell` class, `input[name=quantity]` / `input[name=price]`, an
  `.instrument-name` header and `span.tradingsymbol`/`span.exchange-tag`
  idioms (long-standing Kite markup, cross-checked against community
  userscripts; real Kite sits behind a login so selectors are best-effort by
  design). Every read is layered: name attributes → label-text anchors →
  text anchors, with a pure `assembleCapture()` step (unit-tested) separated
  from DOM collection (fixture-tested).
- **Brittleness contract:** broker DOMs change without notice, so the adapter
  **degrades silently** — unparseable panel ⇒ no button, never a console
  error, never a guessed value (unknown side ⇒ no capture; market orders fall
  back to the visible last price; a zero/garbage qty is captured as empty,
  not invented). `version` is bumped on every selector change and travels
  with each capture (`adapterVersion`, also stamped on the injected button as
  `data-tm-capture="<v>"`), so breakage reports can name the selector
  generation.

### Capture hand-off: content script → SW → side panel

- The injected "Log in TradeMark" pill (inline styles, no stylesheet leakage
  into the broker page) reads the order fields on click and
  `chrome.runtime.sendMessage`s them. The SW stages the capture in
  `chrome.storage.session` (5-minute TTL — stale context is dropped) and
  best-effort opens the side panel on that tab. The panel consumes the
  capture whether it was already open (storage change event) or opens later
  (read-and-clear on mount) and prefills instrument/side/qty/entry with a
  dismissible "From Zerodha Kite" chip. Captures cross a privilege boundary,
  so the panel re-validates the full shape before touching form state.
- **Manual logging is unchanged** — capture is purely additive sugar.

### Privacy boundary

- Adapters read **only the visible order-entry fields** (instrument,
  exchange, side, quantity, price). Balances, holdings, positions and order
  history are out of bounds by design, and nothing is read until the user
  clicks the capture button. See docs/extension.md → Privacy.

### Testing without a Kite login

- Real Kite requires a broker login, so `extension/test-fixtures/` carries a
  static replica of the order-window DOM (plus a deliberately "redesigned"
  variant). The e2e (`scripts/e2e-extension.mjs`) serves the fixtures on
  localhost, registers the **real built content bundle** through the same
  `chrome.scripting` API the settings toggle uses (Chrome's native permission
  prompt is unreachable from Playwright — the prompt is skipped, never the
  code path), and walks: button injection → buy-limit prefill → journal row →
  sell-market prefill with last-price fallback → changed-DOM silent
  degradation. Pure parsing is unit-tested in `kite.test.ts`.

## v1 scope (shipped)

- Side panel + runtime popup fallback sharing one UI; 320 px-min layouts;
  dark theme on app tokens, light via `prefers-color-scheme`.
- Signed-out state → one-click "Sign in to TradeMark" (opens app tab, panel
  auto-detects the session by polling `/api/db/status`).
- **Quick trade log** (hero, ≤10 s): instrument input with contract-name
  parsing (`BANKNIFTY24JUN52000CE`, `NIFTY 25 JUN 2026 24500 CALL`, Fyers
  `NSE:SBIN-EQ`, …) and a parsed confirmation chip; buy/sell toggle; qty;
  entry; optional exit (empty = open trade); optional playbook + notes;
  Enter submits; optimistic success state + "View in journal" link.
- **Today's rules**: the daily checklist with the same tri-state check-offs
  (followed / broken / n.a.) as the dashboard, syncing instantly with the web.
- Header glance strip: today's net P&L + current streak flame (read-only).
- Settings drawer: app URL (default prod; overridable for self-hosters with a
  runtime host-permission request), sign out.
- Polished loading / empty / error / unsupported-mode states.

## Backlog

> **Constraint update (product owner):** broker adapters use **DOM capture under
> the user's own live session** — no broker APIs, no paid market data, no LLM.
> Each adapter is a registry entry + opt-in content script + DOM fixture, byte-
> identical writes via the shared statement builder.

### v2 — broker-page capture

- [x] Content scripts per broker that read the order panel and prefill the trade
      form via one click. _(Kite shipped; adapter registry ready for more brokers.)_
- [x] **Positions/Tradebook auto-import (Kite first)** _(highest value, pure extension-native)_ — read the authenticated positions/orderbook/fills/charges DOM, dedupe against the journal DB, import executed trades in one click via an ImportModal with a preview/include-exclude table. No broker API, no creds. _(Shipped — see "Shipped by the loop".)_
- [ ] **Upstox adapter** (`extension/src/brokers/upstox.ts`) on the registry.
- [ ] **Groww adapter** (`extension/src/brokers/groww.ts`) — DOM-capture path (NOT the API path, which would need an owner-procured key).
- [ ] **Dhan adapter** (`extension/src/brokers/dhan.ts`) — completes the 4-broker set.
- [ ] **Fyers adapter** (`extension/src/brokers/fyers.ts`) — NSE:SBIN-EQ symbols map to the existing quick-log parser.
- [ ] **Rules nudge badge** — `chrome.action.setBadgeText` shows unticked-rule count when the day has trades; chrome.alarms-driven refresh.
- [ ] **Popup mode polish** (compact 320px) + Ctrl+Shift+J keyboard shortcut to open the panel.
- [ ] **Chart screenshot capture** — `chrome.tabs.captureVisibleTab` -> attach via the existing AttachmentRow schema (no new DB columns).
- [ ] **Pre-trade plan capture** — log symbol/side/qty/planned_entry/sl/target before entry, writing the planned_* fields that already exist in TradeRow (no migration); reconciliation lives in the journal discipline-v2 metric.
- [ ] Executed-order toast capture on Kite — still deferred (transient toast DOM unverifiable without a live session; order-window + positions-import cover the high-value paths).

### v3 — distribution

- [ ] **Chrome Web Store asset/zip pipeline** — CI builds dist.zip, screenshots (1280x800), 440x280 tile, privacy-policy page. Build/package is cred-free; the actual store submission is blocked on the owner's Chrome Web Store developer account.
- [ ] Update-notification toast inside the panel.

### v4 — beyond Chrome

- [ ] Firefox port (MV3 sidebar API differences, `browser.*` polyfill).
- [ ] Quick-glance widgets: mini equity sparkline, week P&L strip. _(High effort: needs an SVG sparkline lib + 7-day P&L/equity queries at 320px; lucide not suitable. Stays parked.)_

## Shipped by the loop

- 2026-06-12 — v1: side panel + popup fallback, cookie-session auth with pinned-ID origin allowlist, token-vended Turso writes via the shared statement builder, quick trade log with contract parsing, today's rules tri-state checklist, P&L + streak glance strip, settings, Playwright extension e2e. (PR #22)
- 2026-06-12 — v2: Zerodha Kite order-window capture — opt-in per-broker content scripts, versioned adapter registry, "Log in TradeMark" pill, SW-staged captures, silent degradation, Kite fixtures + 6 e2e steps, 26 unit tests. (PR #37)
- 2026-06-13 — Positions/Tradebook auto-import (Kite first): versioned `kite-positions` adapter (pure `assembleFills` split from DOM collection; reads only executed-order fields; rejected/pending rows skipped; silent degradation on changed markup), `positions-import.ts` (reuses the CSV import's FIFO pairing — fills time-sorted first since Kite renders newest-first — + paise-correct charges + deterministic `stableId` so re-scraping the same tradebook dedupes idempotently and never re-writes already-journaled rows), `ImportModal` preview with new-vs-already-in-journal rows + per-row include/exclude + import progress/result, opt-in `chrome.scripting` registration behind the `kite.zerodha.com` optional host permission, panel-driven scrape (no `tabs` permission — discovers the broker tab by message round-trip), writes through the shared `save-statements.ts`. Committed `kite-tradebook.html` + changed-DOM fixtures; +33 unit tests; 7 new e2e steps (preview, dedupe-hides-existing, import-to-journal, idempotent re-import, silent degradation). (PR #TBD)
