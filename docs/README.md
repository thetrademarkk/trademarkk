# TradeMarkk documentation

The documentation index. Start with the [project README](../README.md) for an overview, or
jump to a topic below.

## Get started

- [Self-hosting guide](SELF_HOSTING.md) — fork, configure, migrate and deploy your own
  TradeMarkk on Vercel + Turso (free tiers).
- [Authentication setup](AUTH_SETUP.md) — Better Auth, email/password, Google sign-in,
  email (Resend), the admin allowlist and rate limiting.
- [Contributing](../CONTRIBUTING.md) — branch → PR → CI → merge workflow, local dev, and the
  gates every change must pass.

## Understand the system

- [Architecture](ARCHITECTURE.md) — the app, the two-database model, client-side compute,
  the extension, and the security model.
- [Product & architecture plan](PLAN.md) — the original design and rationale (dual-mode,
  token-vending, per-user databases, mode switching).
- [Engineering standards](ENGINEERING.md) — cross-cutting rules (a11y, SEO, vitals, PWA,
  caching, SSR, mobile-first, security, testing).
- [Security](../SECURITY.md) — responsible disclosure + privacy stance.
  Detailed model: [docs/SECURITY.md](SECURITY.md).

## Features

- [Community plan](COMMUNITY_PLAN.md) — the public social layer design.
- [Chrome extension](extension.md) — the multi-broker companion side panel (capture,
  import, screenshot, pre-trade plan) and its privacy model.
- [Backtesting design docs](backtesting/00-overview.md) — the in-development backtesting
  platform (overview, builder/results UX, engine semantics, data layer, architecture).

## Roadmaps

These are working, north-star roadmaps — directional and continuously updated, not
guarantees. Treat them as intent, and check the codebase / changelog for what has actually
shipped.

- [Journal roadmap](JOURNAL_ROADMAP.md) — feature parity (and beyond) with paid journals.
- [Community roadmap](COMMUNITY_ROADMAP.md) — social-product-grade UX.
- [Extension roadmap](EXTENSION_ROADMAP.md) — broker adapters and distribution.
- [Landing roadmap](LANDING_ROADMAP.md) — the marketing front door.
- [Segments roadmap](SEGMENTS_ROADMAP.md) — all-trader-type segment × product coverage.
- [Audit roadmap](AUDIT_ROADMAP.md) — repo-wide audit and hardening.
- [Backtesting roadmap, risks & decisions](backtesting/10-roadmap-risks-decisions.md).
