# TradeMarkk — Chrome Web Store listing copy

Everything the owner needs to fill in the Chrome Web Store listing form. The
build/package side is cred-free and automated (`npm run ext:package`); the
**submission** below needs the owner's $5 Chrome Web Store developer account.

## Name

```
TradeMarkk — Trading Journal Companion
```

(Matches `manifest.json` `name`. ≤ 75 chars; the packager validates this.)

## Summary (≤ 132 chars)

```
Log trades and tick your daily rules right beside your broker's page — straight into your own TradeMarkk journal.
```

(111 chars.)

## Category

**Productivity**

## Language

English (India) — copy is India-market focused (NSE/BSE, ₹, F&O).

## Full description

```
TradeMarkk is an open-source trading journal for Indian intraday and F&O
traders. This companion extension puts your journal in a Chrome side panel
right beside your broker tab, so logging a trade takes under ten seconds and
your day's rules stay in view all session.

WHAT IT DOES
• Quick trade log — type a contract name (BANKNIFTY24JUN52000CE,
  NIFTY 25 JUN 2026 24500 CALL, NSE:SBIN-EQ or a plain symbol), get a parsed
  confirmation chip, pick buy/sell, qty and entry, and save. Optional exit,
  playbook and notes.
• Today's rules — your daily discipline checklist with the same
  followed / broken / not-applicable tri-state as the web dashboard, synced
  live, plus a toolbar badge nudging any rules you haven't ticked.
• Glance strip — today's net P&L and your journaling streak in the header.
• Broker-page capture (opt-in) — adds a "Log in TradeMarkk" button to the
  order window on Zerodha Kite, Upstox, Groww, Dhan and Fyers that prefills the
  quick log with the order's instrument, side, quantity and price.
• Tradebook import (opt-in) — read your executed orders straight off the Kite
  Orders/Positions page, deduped against your journal, and import them in one
  click.
• Chart screenshot — attach a screenshot of your chart to the trade you're
  logging.
• Pre-trade plan capture — log your planned entry, stop-loss and target before
  you enter, then reconcile against the actual fill in the journal.

YOUR DATA STAYS YOURS
Everything the extension writes lands in YOUR own journal database — byte-
identical to a trade logged on the web app. In hosted mode it uses the same
short-lived, single-database token the web client uses; in BYOD mode you point
it at your own Turso database. Journal data is NEVER sent to the TradeMarkk
platform server. Broker pages are read only on your click, and only the order
fields you can see — never balances, holdings or positions.

OPEN SOURCE
The extension and the whole platform are open source (MIT):
https://github.com/thetrademarkk/trademarkk — read exactly what it does, or
self-host the entire stack.

Requires Chrome 114+ (side panel). Sign in once on https://thetrademarkk.com
(or your own deployment) and the panel picks up your session automatically.
```

## Permissions — justification (paste into the store's permission notes)

- **sidePanel** — the extension's entire UI lives in Chrome's side panel beside
  the broker tab; this is the surface the user interacts with.
- **storage** — remembers the user's app URL and, in BYOD mode, their own
  database URL + token (this browser only). No third-party data.
- **scripting** — registers the **opt-in** broker-capture and tradebook-import
  content scripts the user explicitly turns on; nothing is injected otherwise.
- **alarms** — refreshes the rules-nudge toolbar badge on a ~60s timer (an MV3
  service worker cannot keep a `setInterval` alive).
- **activeTab** — lets **Capture chart** screenshot the currently visible tab on
  the user's click only (that one tab, that one gesture).
- **Host permission — the TradeMarkk app origin** (`https://thetrademarkk.com/*`
  plus `http://localhost/*` for self-hosters/dev): attaches the user's existing
  session cookie so the panel can vend a single-database token to the user's own
  database. No journal data passes through our server.
- **Optional host permissions — broker origins** (`https://*/*`, narrowed by the
  adapter per broker): run the capture/import content script the user opted into.
  Requested by Chrome only when the user enables capture/import for that broker,
  and returned when they disable it.

## Data handling disclosures (store "Privacy practices" tab)

- **Does this item collect or use user data?** Yes — but only the user's own
  journal data, written to the user's own database; not transmitted to us.
- Personally identifiable info: **No** (the extension stores no name/email; it
  rides the web app session).
- Financial/trade info: handled **locally / written to the user's own database**;
  **not** sent to the developer's servers.
- Authentication info: **No credentials stored** — session cookie only.
- Web history / location / health / personal communications: **No.**
- Data is **not** sold, **not** used for advertising, **not** used for purposes
  unrelated to the single core function (journaling the user's trades).
- Link the privacy policy: host `extension/privacy-policy.md` at a public URL
  (e.g. `https://thetrademarkk.com/extension/privacy` or the GitHub raw/Pages
  URL) and paste it into the listing's "Privacy policy URL" field.

## Assets in this folder

- `screenshots/01-signed-out.png` — 1280×800 — the one-click sign-in hero.
- `screenshots/02-broker-capture.png` — 1280×800 — the "Log in TradeMarkk" pill
  on a Zerodha Kite order window.
- `screenshots/03-settings.png` — 1280×800 — Settings: opt-in broker capture for
  all five brokers + tradebook import.
- `screenshots/04-byod-connect.png` — 1280×800 — the BYOD "connect your own
  database" flow.
- `promo/promo-440x280.png` — 440×280 — small promo tile.

Regenerate any time with `node scripts/ext-store-screenshots.mjs` (after
`npm run ext:build`). The script spins throwaway local servers + a headless
Chromium with the built extension, creates **no** account and provisions **no**
database, and tears everything down.

### Manual-capture checklist (data-rich screens)

The four committed screenshots cover every state that renders **without a live
journal**. Three high-value screens are gated behind a real signed-in journal
with sample trades, which would require creating a platform account + Turso
database — out of scope for the cred-free pipeline. Capture these by hand before
publishing for the strongest listing (the store allows up to 5 screenshots):

1. **Populated quick log** — the hero with a parsed instrument chip
   (e.g. `BANKNIFTY 52000 CE`), qty/entry/exit filled, and the optimistic
   "logged" success state.
2. **Today's rules checklist** — the RulesCard with several rules in the
   followed / broken / n.a. tri-state, plus the rules-nudge toolbar badge.
3. **P&L + streak glance strip** — the header chips showing today's net P&L and
   the current streak flame on a day with trades.

How: build the extension, sign in once on a throwaway hosted account on
`http://localhost:3400` (or prod), import the demo CSV / click "Explore with
sample data", load the side panel, set the browser window to 1280×800, and
screenshot the panel for each state. Name them `05-quick-log.png`,
`06-rules.png`, `07-glance.png` and drop them in `screenshots/`.

## Submission steps (owner-gated — needs the $5 dev account)

1. Pay the one-time $5 Chrome Web Store developer registration fee.
2. Build the upload zip: `npm run ext:package` → produces
   `extension/dist/trademarkk-extension-v<version>.zip`.
3. In the Developer Dashboard → **New item** → upload that zip.
4. Fill name / summary / description / category (Productivity) from above;
   upload the screenshots + promo tile; set the privacy policy URL.
5. Complete the Privacy practices tab using the disclosures above.
6. Submit for review.
7. **After the store assigns the extension ID** (the local `key.pem` was lost,
   so the store will issue a NEW id rather than reuse the pinned dev id), run the
   one-line cutover in `docs/EXTENSION_ROADMAP.md` → v3 to allowlist the new
   `chrome-extension://<id>` on the server (`EXTENSION_ORIGIN` + origin-check +
   Better Auth trustedOrigins).
