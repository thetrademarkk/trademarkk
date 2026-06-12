# Engineering Standards

Living document of the cross-cutting rules every change must respect. Paired with
[PLAN.md](PLAN.md) (journal architecture) and [COMMUNITY_PLAN.md](COMMUNITY_PLAN.md).

## 1. Architecture & code quality

- **Feature-first modules** in `src/features/*` — each owns `components/`, `api.ts`/`queries.ts`,
  `schemas.ts`, `types.ts`, and a public `index.ts` (the only cross-feature import path).
- **Server-only code** lives in `src/server/*` guarded by the `server-only` package — the
  Turso org token and admin checks can never reach the client bundle.
- **Small files**: components ≤ ~150 lines, files ≤ ~250; logic in hooks, pure logic in
  `lib/` with co-located tests. One component per file; kebab-case files, PascalCase components.
- **State placement**: server/shared data → TanStack Query; cross-cutting (theme, DB session)
  → Context; ephemeral UI → Zustand; forms → react-hook-form / local state.
- **Validation at the edges**: every API body + user input parses through Zod; inner code
  trusts types.

## 2. Security

- **All SQL values parameterized.** SQL identifiers from untrusted sources (backup/import,
  migration) pass `assertSafeIdentifiers`.
- **User-generated HTML** (blog submissions) is sanitized **server-side** to a strict
  allowlist (`src/server/blog.ts` → `sanitizeRichHtml`) before storage. Community post bodies
  are plain text (no HTML) — zero XSS surface. `dangerouslySetInnerHTML` is used only for
  (a) sanitized blog HTML, (b) static JSON-LD, (c) the no-flash theme script.
- **Auth + CSRF**: Better Auth sessions (`HttpOnly`, `SameSite=Lax`); every state-changing
  route additionally verifies `Origin` (`isAllowedOrigin`) and the session.
- **AuthZ**: admin routes (`/admin`, `/api/blog/submissions/*`) check `isAdmin(email)` against
  `ADMIN_EMAILS`. Authors can only mutate their own posts/comments (ownership checked server-side).
- **Rate limiting** on every mutation (posts, comments, likes, reports, blog submits, auth,
  provisioning) — Upstash in prod, in-memory fallback in dev.
- **Headers**: `Content-Security-Policy` (no third-party scripts; see the rationale comment
  in `next.config.ts`), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, restrictive
  `Permissions-Policy`. Full disclosure policy in [SECURITY.md](SECURITY.md).
- **Account deletion purges everything** — `purgeUserContent` (`src/server/account.ts`)
  removes posts/comments/likes/follows/profile and anonymizes feedback/analytics before the
  auth rows go (FK cascades are not enforced over libsql HTTP).

## 3. Accessibility (A11y) — review-blocking

- Semantic landmarks (`<nav>`, `<main>`, `<article>`, `<aside>`), correct heading order,
  `<time dateTime>` on all timestamps.
- Every icon-only control has `aria-label`; toggles expose `aria-pressed`; active nav uses
  `aria-current`. Live error containers use `role="alert"`.
- Full keyboard operability — actions are real `<button>`/`<a>`; Radix dialogs trap & restore
  focus; `focus-visible` rings on all interactives (design-system default).
- Images carry alt text; decorative visuals are `aria-hidden`.
- Color is never the sole signal (P&L badges carry text; color-blind-safe palette available).
- `prefers-reduced-motion` honored globally in `globals.css`.

## 4. SEO

- Marketing surface is server-rendered (SSG/ISR) and indexable; `/app/*`, `/community`
  actions, `/admin`, `/blog/write` are `noindex`.
- Per-route `generateMetadata` (canonical, OG, Twitter); `sitemap.ts` + `robots.ts`;
  JSON-LD (`SoftwareApplication`, `FAQPage`, `Article`, sanitized via `jsonLdScript`).
- Blog supports community contributions (programmatic article pages) → more indexable
  long-tail content. Approved posts revalidate on demand (`revalidatePath`).

## 5. Rendering & caching

- **SSR/SSG/ISR**: marketing + blog pages are server components with `export const revalidate`
  (blog = 3600s) and **on-demand revalidation** when an admin approves a post.
- **Client data**: TanStack Query with targeted invalidation keyed to user actions — likes
  patch every cached copy optimistically; posting/commenting/profile edits invalidate the
  exact affected keys, not the whole cache.
- The journal app is client-rendered by design (credentials are browser-held).

## 6. Web Vitals & performance

- Targets: LCP < 2.0s, INP < 200ms, CLS < 0.05.
- `next/font` self-hosted (no layout shift); `next/image` where applicable.
- **Lazy-load heavy/rare code** with `next/dynamic`: the TipTap editor (`RichEditor`), and
  client-only widgets that aren't above the fold. Charts are already isolated per route.
- Infinite feeds use an IntersectionObserver sentinel (no eager over-fetch).
- Skeletons for every async panel; optimistic writes to keep INP low.

## 7. Mobile-first

- Layouts start single-column and enhance at `md`/`lg`/`xl`. Bottom tab bar + centered FAB on
  mobile; sidebar on desktop. Dialogs become bottom sheets (vaul) on small screens.
- Touch targets ≥ 36px; `env(safe-area-inset-*)` respected on the bottom nav.

## 8. PWA

- `manifest.ts` (maskable icons, shortcuts), hand-rolled service worker (`public/sw.js`):
  network-first navigations with offline fallback, cache-first hashed assets + wasm.
- SW registers in production only; **dev actively unregisters stale SWs and clears caches**
  (avoids the localhost asset-404 trap).

## 9. Error handling

- Route error boundaries: `app/error.tsx` (per-route reset), `app/global-error.tsx`
  (root-layout failures), shared `ErrorFallback`. Custom `not-found.tsx`.
- API routes return typed JSON errors with correct status codes; the client surfaces them
  via toasts or inline messages and (for 401) raises the sign-in gate then retries.

## 10. Testing

- Unit (Vitest): pure logic — charges engine, stats, fill-pairing.
- E2E (Playwright, local scripts): `e2e-smoke` (all journal screens + demo), `e2e-hosted`
  (signup → provision → persist → delete), `e2e-community` (post/like/comment/profile/delete),
  `e2e-blog` (submit → admin approve → published), `e2e-byod-switch` (full user journey with
  7 storage-mode switches + data-integrity checks after each).
  Run against a prod build on a separate port with matching `BETTER_AUTH_URL` /
  `NEXT_PUBLIC_APP_URL`, and **always set `NEXT_DIST_DIR=.next-e2e`** for both build and
  start — test builds must never write to the dev server's `.next`.
- CI: typecheck → lint → unit → build.

## 11. Documentation discipline

- Update this file, `PLAN.md`, or `COMMUNITY_PLAN.md` whenever an architectural rule, a new
  cross-cutting feature, or a security/UX decision changes. Keep `.env.example` in sync with
  every new env var.
