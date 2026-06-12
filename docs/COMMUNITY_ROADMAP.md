# Community Roadmap — North Star: LinkedIn/Twitter-grade UX

> **Goal:** continuously evolve the TradeMark community until its polish, depth
> and stickiness match the best social products — while keeping the journal's
> privacy-first architecture (journals never leave the user's DB).
>
> This file is the working backlog for the autonomous improvement loop. Each
> iteration: pick the top unchecked item → research the best-in-class pattern →
> plan → build on a `feature/` branch → verify with Playwright (desktop + 360px
> mobile audit) → PR → CI → merge (never delete branches) → confirm auto-deploy
> → check the item off here with a date + PR number. Small, shippable slices —
> one coherent item per iteration.

## Working rules (non-negotiable)

- Branch → PR → CI green → squash-merge; **never** delete branches; **never** deploy manually (merge auto-deploys).
- No emojis in UI — lucide-react icons only. Paise-precise money. No native confirm/alert — in-app dialogs.
- Every interactive surface: instant cache updates (no reloads), a11y labels, mobile-safe (run `scripts/mobile-audit.mjs`).
- Clean up any e2e users (`e2e-%@example.com`) from the platform DB after verification.
- Real users exist now — migrations must be additive/idempotent; never wipe or rewrite user content.

## Backlog (ordered)

- [x] **Direct messages (chat) v1** — 1:1 conversations: `conversations` + `messages` tables, /community/messages inbox + thread view, "Message" button on profiles, unread badge in header bell area, 5s polling (SSE/websockets later). Block-aware (blocked users can't DM). Rate-limited.
- [x] **Feed composer upgrade** — inline (LinkedIn-style) top-of-feed composer instead of dialog-only; image preview grid; draft persistence. _(2026-06-12, PR #18)_
- [x] **Post detail polish** — back navigation context, share-count, related posts by tag, sticky comment box on mobile. _(2026-06-12, PR #28 — plus follow chip in author header, absolute dates, OG metadata, structured skeleton, Ctrl+Enter composer)_
- [x] **Notification grouping** — "X and 3 others liked your post" rollups, mark-one-read, notification page (not just dropdown). _(2026-06-12, PR #36 — avatar stacks, read/unread partition, scoped `{ ids }` mark-read, /community/notifications page with New/Earlier)_
- [ ] **Profile polish** — pinned post, post/comment count tabs (Posts | Comments | Likes), cover accent color picker.
- [ ] **Search v2** — unified search across posts/users/tags with keyboard navigation (Twitter-style typeahead).
- [ ] **Chat v2** — typing indicators, read receipts, image attachments (after DM v1 ships and is stable).
- [ ] **Feed quality** — "Top" algorithm improvements (decayed engagement score), per-tag follow, muted words.
- [ ] **Onboarding moments** — first-post nudge, follow-suggestions card for new members, empty-feed starter content.
- [ ] **Moderation v2** — shadow-hide reported content above a threshold pending review; admin audit log.

## Shipped by the loop

<!-- The loop appends: - [x] YYYY-MM-DD — item — PR #N -->

- [x] 2026-06-12 — Direct messages (chat) v1 — PR #12
- [x] 2026-06-12 — Feed composer upgrade (inline top-of-feed composer, drafts in tm.community-draft) — PR #18
- [x] 2026-06-12 — Post detail polish (back-nav context, share counts, related rail, docked mobile composer, follow chip) — PR #28
- [x] 2026-06-12 — Notification grouping (LinkedIn-style rollups, scoped mark-read, /community/notifications page) — PR #36
