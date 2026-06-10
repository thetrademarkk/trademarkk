# Security

## Reporting a vulnerability

Please email the maintainer or open a private GitHub security advisory. Do not open public
issues for security problems. We aim to respond within 72 hours.

## Security model

### Secrets & tokens
- The **Turso org/platform API token never leaves the server** — modules touching it import
  the `server-only` package, so any accidental client import fails the build.
- Hosted users receive **short-lived (7-day) tokens scoped to their single database**, minted
  per session via `/api/db/token`. The hot path (queries) goes browser → Turso directly; our
  server never proxies or sees journal data.
- BYOD credentials live **only in the user's browser** (localStorage), optionally encrypted
  at rest with AES-GCM (PBKDF2, 250k iterations) behind a passphrase. They are never sent to
  our servers.

### Injection
- All SQL **values** are parameterized everywhere.
- SQL **identifiers** from untrusted sources (backup JSON imports, external DB schemas during
  storage-mode migration) are allowlist-validated (`src/lib/db/identifiers.ts`).
- No user content is rendered as HTML; `dangerouslySetInnerHTML` is used only for static
  JSON-LD and a static theme-init script.

### Auth & CSRF
- Authentication via Better Auth; session cookies are `HttpOnly` + `SameSite=Lax`.
- State-changing API routes additionally verify the `Origin` header
  (`src/server/origin-check.ts`).
- Email verification gates hosted-DB provisioning (abuse control); provisioning and token
  minting are rate limited (Upstash in production, in-memory fallback in dev).

### Isolation
- Hosted mode is **database-per-user** — there is no shared table and no `WHERE user_id`
  to forget. A query bug cannot leak another user's data.
- The platform DB stores auth + db-name mapping only, never journal rows.

### Headers
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, restrictive `Permissions-Policy`.

## Known trade-offs (documented by design)
- BYOD tokens in localStorage are readable by successful XSS; mitigations: no third-party
  scripts, no HTML rendering of user content, optional passphrase encryption. The token's
  blast radius is the user's own journal.
- A strict Content-Security-Policy (nonce-based) is on the roadmap; it requires wiring
  nonces through Next's inline scripts.
- Hosted-mode session tokens are cached in `sessionStorage` for 24h to reduce mint calls.
