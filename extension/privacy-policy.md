# TradeMarkk Extension — Privacy Policy

_Last updated: 2026-06-13_

TradeMarkk is an open-source trading journal. The **TradeMarkk — Trading
Journal Companion** Chrome extension is a thin side panel that lets you log
trades and tick your daily rules without leaving your broker's web page.

The guiding principle: **your journal data is yours.** The extension writes
trades only to **your own** journal database and never sends your trading data
to the TradeMarkk platform server.

## What the extension accesses

- **Your TradeMarkk web session.** The extension rides the cookie session you
  already have on the TradeMarkk web app (or your own self-hosted deployment).
  Chrome attaches that session cookie because the extension holds host
  permission for the app origin. The extension itself **stores no credentials,
  passwords or OAuth tokens**.
- **Your own journal database.** In hosted mode the extension mints the same
  short-lived, single-database token the web client uses and connects directly
  to your Turso database. In BYOD ("bring your own database") mode you paste
  your own database URL and token once; they are kept in `chrome.storage.local`
  in this browser only. Either way, **journal writes go straight to your
  database — never through the TradeMarkk platform server.**
- **Order-entry fields on broker pages (opt-in only).** If you turn on **Broker
  capture** for a broker (Zerodha Kite, Upstox, Groww, Dhan or Fyers), a small
  "Log in TradeMarkk" button is added to that broker's order window. When you
  click it, the extension reads **only the visible order-entry fields**:
  instrument name, exchange, buy/sell, quantity and price (market orders use
  the visible last-traded price). It reads **nothing on its own** — only on your
  click — and it **never** reads balances, holdings, positions, P&L totals or
  order history.
- **Executed orders on the broker's Orders/Positions page (opt-in only).** If
  you turn on **Tradebook import** and click "Import", the extension reads
  **only the per-trade fields a journal row needs** off that page (instrument,
  exchange, side, quantity, average price, time and order status). It never
  reads account balance, free margin, holdings value or P&L totals.
- **A screenshot of the tab you choose (on click only).** **Capture chart**
  uses the `activeTab` permission to screenshot the currently visible tab on
  your explicit click. The image is downscaled and compressed locally in your
  browser and written directly to your journal database as a trade attachment.
  It cannot see other tabs or background pages.

## What the extension does NOT do

- It does **not** send your trades, screenshots, balances, holdings or any
  journal data to the TradeMarkk platform server or to any third party.
- It does **not** collect analytics, advertising identifiers or browsing
  history.
- It does **not** read broker pages unless you have explicitly enabled capture
  or import for that broker, and even then only when you click the button.
- It does **not** store your broker credentials or your TradeMarkk password.

## Permissions and why each is needed

| Permission                      | Why                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `sidePanel`                     | Show the companion UI in Chrome's side panel beside your broker tab.                                |
| `storage`                       | Remember your app URL and (BYOD only) your own database URL/token, in this browser.                 |
| `scripting`                     | Register the opt-in broker-capture / tradebook-import content scripts you turn on.                  |
| `alarms`                        | Refresh the rules-nudge toolbar badge on a low-frequency timer (the MV3 service worker can't poll). |
| `activeTab`                     | Screenshot the visible tab when you click **Capture chart** — that one tab, on that one click.      |
| Host: the TradeMarkk app origin | Attach your existing session so the panel can vend a token to your own database.                    |
| Optional host: broker origins   | Run the capture/import content script you opted into — requested by Chrome only when you enable it. |

The broker host permissions are **optional**: nothing runs on a broker page
until you enable capture or import for it, and turning the toggle off removes
both the content script and the host permission.

## Data retention

- Journal data lives in **your** database, under your control. Deleting your
  TradeMarkk account purges your platform record and provisioned database.
- BYOD database credentials and your app-URL setting live in
  `chrome.storage.local` and are removed when you uninstall the extension or
  clear them in Settings.
- Captured order fields are held transiently in `chrome.storage.session`
  (cleared after 5 minutes or when the browser closes) only long enough to
  prefill the quick log.

## Open source

The extension and the entire TradeMarkk platform are open source:
<https://github.com/thetrademarkk/trademarkk>. You can read exactly what the
extension does, and self-host the whole stack if you prefer.

## Contact

Questions about privacy: open an issue at
<https://github.com/thetrademarkk/trademarkk/issues>.
