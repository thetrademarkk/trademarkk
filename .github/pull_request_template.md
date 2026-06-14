<!--
  Thanks for contributing to TradeMarkk! Please keep PRs focused.
  Branch naming: feature/ | fix/ | chore/ . PR title: Conventional Commits (e.g. feat(scope): …).
-->

## What & why

<!-- A short description of the change and the motivation. Link any related issue (Fixes #123). -->

## Type of change

- [ ] Bug fix
- [ ] Feature
- [ ] Docs
- [ ] Chore / refactor

## Checklist (the CI `verify` gates)

- [ ] `npm run typecheck` passes
- [ ] `npm run ext:typecheck` passes
- [ ] `npm run lint` passes with **zero warnings**
- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] `npm run ext:build` succeeds (if the extension is affected)

## Quality checklist

- [ ] Follows the conventions in [CONTRIBUTING.md](../CONTRIBUTING.md) (feature-first, small files, semantic Tailwind tokens, lucide-only icons, no emojis)
- [ ] Money/charges changes stay paise-correct (golden tests added/updated)
- [ ] Accessibility respected (keyboard, aria-labels, color not the sole signal)
- [ ] `.env.example` and docs updated if a new env var or behavior was added
- [ ] Verified the affected flow locally against a **prod build** (the strict CSP breaks `next dev` for the journal app)

## Screenshots / notes

<!-- Optional: before/after screenshots, or anything reviewers should know. Do not include secrets. -->
