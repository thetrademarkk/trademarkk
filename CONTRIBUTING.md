# Contributing to TradeMarkk

Thanks for your interest in improving TradeMarkk. This is an open-source (MIT) trading
journal for Indian traders, and contributions — bug fixes, features, docs, broker adapters
— are welcome. This guide covers the workflow, local setup, the gates every change must
pass, and the code conventions.

Please also read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) to understand the system, and
[docs/ENGINEERING.md](docs/ENGINEERING.md) for the full cross-cutting standards.

## Workflow: branch → PR → CI → merge

1. **Branch off `main`.** Use a `feature/`, `fix/` or `chore/` prefix:
   `git checkout -b feature/<slug>`. Never commit directly to `main`.
2. **Make your change** following the conventions below. Keep PRs focused.
3. **Run the gates locally** (see below) before pushing.
4. **Open a pull request** against `main`. CI (the `verify` job) must pass before merge;
   `main` is branch-protected.
5. **Merge** is typically a squash with a [Conventional Commits](https://www.conventionalcommits.org/)
   title, e.g. `feat(community): …`, `fix(charges): …`, `docs: …`.

Branch history is preserved — branches are not deleted after merge.

## Local development setup

Requirements: **Node 22+** and npm.

```bash
npm install --legacy-peer-deps
cp .env.example .env.local      # fill in at least the required vars
npm run migrate:platform        # create the platform (auth) tables
npm run dev                      # marketing site at http://localhost:3000
```

See [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md#3-configure-environment) for what each
environment variable does. For just hacking on the marketing site or pure-logic libs, you
don't need real Turso credentials.

### Running things locally

> **The strict CSP and `next dev`.** The app's Content-Security-Policy has no
> `unsafe-eval`, but Next.js dev mode (React Fast Refresh) relies on `eval`, so the
> **journal app screens won't hydrate under `npm run dev`** — only the marketing site does.
> To work on auth, onboarding or the journal, run a **production build** on a port whose
> origin matches your env:
>
> ```bash
> NEXT_PUBLIC_APP_URL=http://localhost:3000 BETTER_AUTH_URL=http://localhost:3000 npm run build
> npm start
> ```
>
> This also applies to Playwright end-to-end tests — they must run against a **prod build**,
> with `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` matching the served port. Set
> `NEXT_DIST_DIR=.next-e2e` so test builds don't clobber your dev `.next`. If `RESEND_API_KEY`
> is empty, email verification is off and sign-up returns a session immediately (the path
> the e2e scripts rely on).

## The gates

CI's `verify` job runs these in order; run them locally before opening a PR:

| Command | Gate |
| --- | --- |
| `npm run typecheck` | App TypeScript — must be clean |
| `npm run ext:typecheck` | Extension TypeScript — must be clean |
| `npm run lint` | ESLint — **zero warnings** (the pre-commit hook enforces `--max-warnings=0`) |
| `npm test` | Vitest unit tests — must pass |
| `npm run build` | Production build must succeed |
| `npm run ext:build` | Extension bundles must build |

A **Husky pre-commit hook** runs `lint-staged` (ESLint `--fix --max-warnings=0` +
Prettier) and the typecheck/tests on staged files, so most issues are caught before they
reach CI.

### End-to-end tests (local, not in CI)

Playwright e2e scripts live in `scripts/e2e-*.mjs` (smoke, hosted lifecycle, community,
blog, BYOD mode-switch, extension, …) plus `scripts/mobile-audit.mjs`. They are **local
verification tools**, not part of CI. Run the relevant flow against a prod build (see the
CSP note above) when your change touches that surface. Playwright is a dev dependency;
reinstall it with `npx playwright install chromium` if it gets pruned.

## Code style & conventions

- **Feature-first modules** in `src/features/*` (each with its own `components/`, hooks,
  `schemas.ts`, `types.ts`, and a public `index.ts` — the only cross-feature import path).
  Pure logic in `src/lib/*` with co-located tests; server-only code in `src/server/*`
  guarded by the `server-only` package.
- **Small files:** components ≤ ~150 lines, files ≤ ~250; logic in hooks. One component per
  file, kebab-case filenames, PascalCase components.
- **Validate at the edges:** every API body and user input parses through Zod.
- **Styling:** Tailwind v4 with **semantic design tokens** (e.g. `bg-surface`, `text-muted`,
  `text-accent`) — no raw hex colors. Honor the four themes, the color-blind-safe P&L
  palette and `prefers-reduced-motion`. Mobile-first.
- **Icons:** **lucide-react only.** **No emojis** anywhere in UI or code.
- **Money is paise-correct.** Anything touching charges/P&L must keep cent-for-cent
  accuracy — add or update golden tests in `src/lib/charges/` when relevant.
- **Accessibility is review-blocking:** semantic landmarks, correct heading order,
  `aria-label` on icon-only controls, full keyboard operability, alt text, and color is
  never the sole signal. See [docs/ENGINEERING.md](docs/ENGINEERING.md#3-accessibility-a11y--review-blocking).
- **Keep `.env.example` in sync** whenever you add an environment variable, and update the
  relevant doc.

## Reporting bugs & requesting features

Open a GitHub issue using the templates in
[`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE). For **security** issues, do **not**
open a public issue — see [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the project's
[MIT License](LICENSE).
