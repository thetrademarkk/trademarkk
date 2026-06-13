# Community Roadmap — North Star: LinkedIn/Twitter-grade UX

> **Goal:** continuously evolve the TradeMarkk community until its polish, depth
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

Research-driven ranked queue. Already-shipped foundations (DM v1 PR #12, inline
composer PR #18, post-detail polish PR #28, notification grouping PR #36,
profile polish, header search v2) live in the "Shipped by the loop" log below.

1. [x] **Richer reactions** — Like / Insightful / Respect / Celebrate (LinkedIn-style), one per user, hover/long-press picker, stacked summary, reaction-weighted Top-feed. _(2026-06-13, PR — this iteration)_
2. [x] **@mention + $cashtag + #hashtag composer autocomplete** — inline typeahead in the composer & comment box; resolves handles/symbols/tags as you type. _(2026-06-13, PR #63)_
3. [x] **Edit posts/comments in a 15-min window** with an immutable edit history ("edited" marker + revision log). _(2026-06-13, PR #70)_
4. [x] **Decayed, cost-weighted Top-feed hot-score** — comments/reshares weigh more than reactions, recency decay, per-author diversity cap; deterministic, no ML. _(2026-06-13, PR #75)_
5. [x] **Link OG unfurl preview cards** — SSRF-safe host allowlist for fetched links + own OG tags on posts. _(2026-06-13, PR #75)_
6. [x] **$cashtag tagging + per-symbol stream pages** — NSE/BSE symbol master, `post_symbols` join, per-ticker page, not-advice banner, SEO. _[KILLER]_ _(2026-06-13, PR — this iteration)_
7. [ ] **Quote post / reshare** + reshare-with-thoughts.
8. [ ] **Topic/tag pages + follow-a-tag** — followed tags flow into the Following feed.
9. [ ] **Trending tickers & topics board** — cron snapshot; velocity + unique-author; "not a recommendation". _[needs #6]_
10. [ ] **Optional Bullish/Bearish sentiment tag** — 24h per-symbol gauge; never a BUY verdict. _[needs #6]_
11. [ ] **Watchlist-driven feed scope** — watched symbol OR followed author. _[needs #6]_
12. [ ] **For-You interest feed + cold-start starter follows** — engaged tags + 2nd-degree by hot-score; onboarding seeds; no ML.

**Later (13–20):** content-quality gate · admin moderation/report-queue UI · SSE "N new posts" pill · reputation/track-record · follow suggestions · event/earnings threads · notification preferences · awards · then DM v2 (images/typing/read-receipts) · muted words.

## Shipped by the loop

<!-- The loop appends: - [x] YYYY-MM-DD — item — PR #N -->

- [x] 2026-06-12 — Direct messages (chat) v1 — PR #12
- [x] 2026-06-12 — Feed composer upgrade (inline top-of-feed composer, drafts in tm.community-draft) — PR #18
- [x] 2026-06-12 — Post detail polish (back-nav context, share counts, related rail, docked mobile composer, follow chip) — PR #28
- [x] 2026-06-12 — Notification grouping (LinkedIn-style rollups, scoped mark-read, /community/notifications page) — PR #36
- [x] 2026-06-13 — Richer reactions (Like/Insightful/Respect/Celebrate; additive `likes.reaction` + denormalized `posts.reactions`; hover/long-press picker, stacked summary, weighted Top-feed) — PR (this iteration)
- [x] 2026-06-13 — @mention + $cashtag + #hashtag composer autocomplete (caret-aware typeahead in the composer & comment box; block-aware @users + #tags via `GET /api/community/autocomplete`, curated in-repo $symbols client-side w/ free entry; keyboard-navigable listbox; rich-text linkifies all three; signed-in 360px header overflow fixed) — PR #63
- [x] 2026-06-13 — Edit posts/comments in a 15-minute window + immutable edit history (author-only `PATCH /api/community/posts/[id]` & `/comments/[id]`, server-enforced window → 410 once closed, same zod re-validation + newly-added @mention re-extraction as create; additive `edited_at` + append-only `edit_history` JSON columns on posts & comments; owner "Edit" action with "N min left" hint, inline form reusing the composer, "Edited · view history" marker + read-only history dialog; optimistic edit with rollback; edits rate-limited 30/h) — PR #70
- [x] 2026-06-13 — $cashtag tagging + per-symbol stream pages (the KILLER): expanded `symbols.ts` to a 318-entry NSE/BSE master `{symbol,name,exchange}` + `normalizeSymbol`/`lookupSymbol`/`isKnownSymbol`; pure `cashtags.ts` (`extractCashtags` word-initial `$SYMBOL`, dedupe/uppercase/cap-12, known + free-entry; `planSymbolSync`add/remove plan); additive idempotent`post_symbols`join (PK post_id+symbol, indexed by symbol & post) synced on post create AND edit via`syncPostSymbols`; per-symbol stream at `/community/s/[symbol]`(server header with symbol/company/exchange + post count + "Educational discussion, not investment advice" banner, Latest/Top tabs reusing`queryFeed`filtered by`post_symbols`, block-aware, empty state, composer pre-titled with the ticker; on-demand ISR `revalidate=300`+`generateStaticParams()=>[]`, per-symbol metadata/OG/canonical); rich-text $CASHTAG → `/community/s/SYMBOL` chip + a "mentioned tickers" row on each post card) — PR
- [x] 2026-06-13 — Decayed, cost-weighted Top-feed hot-score finalized + per-author diversity cap (verified the PR #60 `topFeedScore`: weighted reactions Insightful/Respect ×1.5 / Celebrate ×1.2 / Like ×1, comments ×2, Hacker-News gravity decay `(engagement+1)/(age+2)^1.2`; added pure `applyDiversityCap` so at most 2 posts per author lead the Top window — overflow appended, never dropped, deterministic; wired into `queryFeed` over the full scored candidate set before slicing, skipped on single-author profile views) — PR #75
- [x] 2026-06-13 — Link OG unfurl preview cards (rich title/description/image/site card below a post for the FIRST link in its body; new SSRF-safe server fetcher: https-only, DNS-resolves the host + blocks every private/loopback/link-local/ULA/metadata range incl. IPv4-mapped IPv6, manual redirect-following that re-validates each hop so a public URL can't 30x into a private host, 5s timeout, ~512KB read cap, plain-text-only sanitized extraction, optional `UNFURL_ALLOWED_HOSTS` allowlist; additive idempotent `link_unfurls` cache table keyed by URL hash with TTL refresh + negative caching; lazy `GET /api/community/unfurl?postId=` resolving the link server-side, never from the query string; `UnfurlCard` via next/image — browser loads `/_next/image` same-origin so the strict img-src CSP holds — with a lucide Globe fallback, opens in a new tab rel=noopener) — PR #75
