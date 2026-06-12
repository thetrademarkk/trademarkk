# TradeMark Chrome Extension

Log trades and tick your daily rules **without leaving your broker's web page**
(Zerodha Kite, Upstox, Groww, Dhan, Fyers — any tab, really). The extension is
a Manifest V3 side panel that writes to the **same journal database** as the
web app, so everything you log appears in your journal instantly and
identically.

Architecture decisions and the iteration backlog live in
[EXTENSION_ROADMAP.md](EXTENSION_ROADMAP.md).

## Broker capture (v2)

Turn on **Settings → Broker capture → Zerodha Kite** and the extension adds a
small **"Log in TradeMark"** button to Kite's order window. Clicking it sends
the order's instrument, side, quantity and price (market orders use the last
traded price) straight into the side panel's quick log — review, tweak, Enter.
Manual logging is unchanged; capture is purely a shortcut.

- **Opt-in only**: nothing runs on broker pages until you enable it, and
  Chrome asks for its own permission on `kite.zerodha.com` once. Turning the
  toggle off removes both the script and the permission.
- **Honest about breakage**: broker pages change without notice. When Kite's
  DOM stops matching, the button simply disappears (and captures carry an
  adapter version so reports can pinpoint the breakage) — the extension never
  guesses values or breaks the broker page.

### Privacy

- The capture script reads **only the order-entry fields you can see** in the
  order window: instrument name, exchange, buy/sell, quantity, price.
- It **never** reads balances, holdings, positions, order history or anything
  else on the page — and it reads nothing at all until you click the button.
- Captured fields go directly from the broker tab to your side panel via the
  extension's own service worker (held in `chrome.storage.session`, expiring
  after 5 minutes or when the browser closes). They are **never** sent to the
  TradeMark platform server — like every journal write, the saved trade goes
  straight to **your** database.

## What it does (v1)

- **Quick trade log** — type a contract name (`BANKNIFTY24JUN52000CE`,
  `NIFTY 25 JUN 2026 24500 CALL`, `NSE:SBIN-EQ`, or a plain symbol), get a
  parsed confirmation chip, pick Buy/Sell, qty, entry — and optionally exit
  (leave it empty to log an open trade). Enter saves. Under ten seconds.
- **Today's rules** — your daily discipline checklist with the same
  followed / broken / n.a. tri-state as the dashboard, synced live.
- **Glance strip** — today's net P&L and your journaling streak in the header.
- **Settings** — point the extension at your own deployment (TradeMark is
  open source), sign out.

## Install (load unpacked)

1. Build the extension:

   ```bash
   npm install
   npm run ext:build        # outputs extension/dist
   ```

2. Open `chrome://extensions` in Chrome (114+).
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `extension/dist` folder.
5. Pin the TradeMark icon and click it — the side panel opens.
6. Click **Sign in to TradeMark**: a normal app tab opens; sign in once and
   the panel picks the session up automatically.

The manifest carries a pinned `key`, so the extension ID is always
`ibfnimbkdoiafemjonbnnjhnojodanej` no matter where it's loaded from — the
hosted app already allowlists it.

## Storage modes

| Web app mode       | Extension behavior                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hosted**         | Works automatically — the panel mints the same short-lived, single-DB token the web client uses.                                                    |
| **BYOD**           | Paste your Turso database URL + token once (kept in `chrome.storage.local`, this browser only).                                                     |
| **Local (sql.js)** | Not reachable from an extension by design (the journal lives inside the web app's browser storage). The panel explains and links to mode switching. |

## Security model

- **No credentials stored** (hosted): the extension rides the web app's
  Better Auth session cookie. Chrome attaches it because the extension holds
  host permissions for the app origin — nothing is copied or persisted.
- **Pinned origin**: the server allows `chrome-extension://<pinned-id>`
  exactly (env `EXTENSION_ORIGIN`; set it to your own ID if you fork, or to
  empty to disable). Wildcard extension origins are never trusted. Sessions
  and rate limits still apply to every request.
- **Scoped DB tokens**: hosted tokens are minted per user, scoped to that
  user's single database, valid 7 days, cached at most 24h in
  `chrome.storage.session` (cleared when the browser closes).
- **Journal data never touches the platform server** — the panel talks to
  your Turso database directly, exactly like the web client.
- Minimal permissions: `sidePanel`, `storage`, `scripting`, host permissions
  for the app origin only. Broker-page access is an **optional** permission,
  requested only when you enable Broker capture and returned when you disable
  it (see "Broker capture" above). No tabs snooping.

## Self-hosters

Open the panel's settings (gear icon) and set your deployment's URL. Chrome
will ask for permission on that origin once. On the server, set
`EXTENSION_ORIGIN=chrome-extension://<your-extension-id>` — if you load the
unmodified extension, the default pinned ID works out of the box.

## Development

```bash
npm run ext:typecheck   # tsc over extension/ (chrome types, strict)
npm run ext:build       # vite build → extension/dist
npm test                # includes extension unit tests (vitest)
```

- Source lives in `extension/src`; `@/...` imports resolve into the app's
  `src/` so the panel reuses the web client's statement builders
  (`src/features/trades/save-statements.ts`), instrument parser and charge
  math — that's what guarantees identical writes.
- After a rebuild, click the refresh icon on `chrome://extensions`.
- The extension never runs migrations; if a journal's schema is behind, the
  panel asks the user to open the web app once (which migrates on connect).
