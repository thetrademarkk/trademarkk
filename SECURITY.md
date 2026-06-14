# Security policy

TradeMarkk is a financial trading journal — data privacy and integrity matter. We take
security reports seriously and appreciate responsible disclosure.

> The full security model (auth, isolation, injection defenses, headers, known trade-offs)
> is documented in [docs/SECURITY.md](docs/SECURITY.md) and
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security-model).

## Reporting a vulnerability

Please report security issues **privately** — do **not** open a public GitHub issue.

- Preferred: open a **private security advisory** via the repository's
  **Security → Report a vulnerability** tab on GitHub, or
- Email the maintainer (contact listed on the GitHub profile /
  [thetrademarkk.com](https://thetrademarkk.com)).

Please include enough detail to reproduce: affected URL/route or component, steps, expected
vs. actual behavior, and impact. We aim to acknowledge within **72 hours** and will keep you
updated on the fix. Please give us reasonable time to remediate before any public disclosure.

## Privacy stance

Privacy is an architectural property of TradeMarkk, not just a policy:

- **Your journal stays yours.** In **BYOD** mode (your own database) and **local/demo**
  mode (in-browser SQLite), journal data **never reaches our servers**. BYOD credentials
  live only in your browser, optionally AES-GCM-encrypted behind a passphrase.
- **Hosted mode** uses a **database-per-user** model: the browser talks to your isolated
  database directly with a short-lived, single-database token. The server never proxies or
  stores your trades, and the Turso org token never leaves the server.
- **No third-party script trackers.** The Content-Security-Policy allows no third-party
  script hosts; first-party analytics are path-only and anonymizable.

## Scope

**In scope:** authentication/session handling, hosted-DB provisioning and token vending,
the platform DB and API routes, community/blog/admin authorization, XSS/injection,
CSRF/origin handling, the CSP and security headers, and the Chrome extension's permission
and capture model.

**Out of scope (typically):** vulnerabilities in third-party services we depend on (report
those to the respective vendor — Turso, Vercel, Better Auth, Resend, Upstash, Google
OAuth), self-inflicted issues in a fork's own misconfiguration, denial-of-service via
volumetric traffic, and reports requiring physical/privileged access to a user's own device
(BYOD tokens in `localStorage` are documented as readable by a successful XSS — the
mitigation is the no-third-party-script CSP and no HTML rendering of user content; see the
[known trade-offs](docs/SECURITY.md#known-trade-offs-documented-by-design)).
