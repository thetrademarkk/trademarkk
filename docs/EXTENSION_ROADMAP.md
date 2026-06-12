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

### v2 — broker-page capture

- [ ] Content scripts per broker that read the order panel / positions table
      (Kite first, then Upstox) and prefill the trade form via one click —
      "capture this order". Strict allowlist of broker domains, read-only DOM
      access, no injected UI beyond the capture affordance.
- [ ] Popup mode polish (compact width) + keyboard shortcut to open the panel.
- [ ] Optional reminder badge when the day has trades but unticked rules.

### v3 — distribution

- [ ] Chrome Web Store listing: production zip pipeline, screenshots, privacy
      policy page, store copy. (The committed `key` keeps the ID stable.)
- [ ] Update-notification toast inside the panel.

### v4 — beyond Chrome

- [ ] Firefox port (MV3 sidebar API differences, `browser.*` polyfill).
- [ ] Quick-glance widgets: mini equity sparkline, week P&L strip.

## Shipped by the loop

- 2026-06-12 — v1: side panel + popup fallback, cookie-session auth with
  pinned-ID origin allowlist, token-vended Turso writes via the shared
  statement builder, quick trade log with contract parsing, today's rules
  tri-state checklist, P&L + streak glance strip, settings (app URL override +
  sign-out), Playwright extension e2e. (PR #22)
