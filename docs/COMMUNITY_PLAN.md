# TradeMarkk Community — Plan (+ separate journal research)

> **Two independent tracks, planned together but distinct:**
>
> **Track A — Community (new product area, this document's focus).** A trader
> community inside TradeMarkk — posts, comments, trade ideas, images — stored
> **centrally in our platform DB**. Community content is public by definition, so
> central storage doesn't break the "your journal stays yours" promise; the journal
> never leaves the user's DB — sharing a trade copies a snapshot the user approves.
>
> **Track B — Journal improvements (from the reference video).** The walkthrough
> video ("how I journal my trades — India's Best Journal Platform", a TradesViz-class
> workflow) is a reference for the _existing journal_ only. Findings in §3.

---

## 1. Community UX research (Track A)

- **Twitter/X + TradingView Ideas** for the feed & "trade idea card" pattern.
- **Reddit** for flat comments v1.
- **MDN/Linear** restraint: dense, dark, fast — no gamification noise at v1.

---

## 2. Community — product spec

### 2.1 Identity model (important)

- Community identity = **TradeMarkk account** (Better Auth). Hosted users already have one.
- **BYOD/local users can join too**: they sign in/up _just for community_ — their journal
  stays wherever it is. UI copy makes this explicit.
- Public identity = **handle** (`@nifty_scalper`) + display name + bio. Handle is
  auto-generated on first community action, editable once chosen (3–20 chars, a-z0-9\_).
- Avatars v1 = deterministic gradient initials (no image uploads for faces; cheap, fast, safe).

### 2.2 Core objects

1. **Post** — text (≤5,000 chars), optional title (≤120), up to 4 topic tags,
   up to 2 images (client-compressed WebP ≤ 200 KB each), optional **Trade Card**.
2. **Trade Card** — the differentiator. A structured, beautiful snapshot shared _from the
   journal_: instrument, direction, entry/exit/SL/target, R-multiple, hold time, and an
   **opt-in P&L toggle** (₹ hidden by default — traders share setups, not balances).
   It's a copied snapshot (JSON), never a live link into the private journal.
3. **Comment** — flat, ≤2,000 chars.
4. **Like** — one per user per post, optimistic UI.
5. **Report** — every post/comment reportable with reason; stored for admin review.

### 2.3 Surfaces & UX

```
/community            Feed — tabs: Latest | Top (7d) · tag filter chips
/community/post/[id]  Post detail + comments
/community/u/[handle] Public profile: avatar, bio, joined, posts
```

- **Layout:** standalone section sharing the marketing header (consistent brand).
  Desktop = 3 columns: left sticky rail (tabs, topics, guidelines), center feed
  (single readable column, ~640px), right rail (compose CTA, rules card, disclaimer).
  Mobile = single column, sticky tab switcher, FAB to compose.
- **Feed card:** gradient-initial avatar · @handle · time-ago · clamped body with
  "show more" · trade card · image grid · action row (♥ like w/ count, 💬 comments,
  copy-link, report).
- **Composer:** dialog (desktop) / full sheet (mobile): body, tag picker (suggested:
  nifty, banknifty, options, psychology, setups, question), image attach (paste or
  pick, auto-compressed), trade attach (from journal), prominent one-line disclaimer.
- **Share from journal:** "Share to community" on every trade detail page → composer
  pre-filled with that trade's card (+P&L toggle). If not signed in → inline sign-in
  gate (reuses AuthForm in a dialog), then continues.
- **Logged-out readers** see everything (growth!); any action raises the sign-in gate.
- **Empty/loading states** everywhere; optimistic likes/comments; toasts on errors.
- **Compliance:** persistent footer + composer note: _"Educational discussion only —
  nothing on TradeMarkk is investment advice."_ (SEBI-sane defaults for an Indian
  trading community.)

### 2.4 Accessibility (non-negotiable, app-wide)

- Semantic structure: `<article>` per post, `<nav>` rails, correct heading order,
  `<time dateTime>` on timestamps.
- Every icon-only control gets `aria-label`; like buttons expose `aria-pressed`.
- Full keyboard operability — all actions are real buttons/links; Radix dialogs trap
  and restore focus; visible `focus-visible` rings (design system already provides).
- Images get alt text (author caption or sensible default); decorative visuals are
  `aria-hidden`.
- Color is never the only signal (badges carry text, not just red/green).
- Forms: programmatic labels, inline error text adjacent to fields, `aria-busy`
  submit states.

### 2.5 Trust & safety (v1)

- Rate limits: 5 posts/hour, 20 comments/hour, 60 likes/hour per user.
- Lengths/zod validation server-side; images size-capped server-side.
- Author-delete own content; report queue in DB (admin UI = backlog).
- Origin checks + session auth on all mutations (same pattern as existing routes).
- No HTML rendering of user content (plain text + whitespace), so no XSS surface.

### 2.6 Architecture

- **Storage:** the existing platform Turso DB (already holds auth). Community tables
  join `user.id`. Text-first content → tiny rows; images capped & rare → acceptable
  in-DB for v1 (move to object storage when volume demands).
- **API:** Next.js route handlers (server-mediated — unlike the journal, community is
  shared state). Denormalized `like_count`/`comment_count` on posts for cheap feeds.
  Cursor pagination (`created_at < cursor`).
- **Client:** TanStack Query (infinite feed, optimistic like/comment), feature module
  `src/features/community/*` per repo standards.

```
profiles   user_id PK→user, username UNIQUE, display_name, bio, created_at
posts      id ULID, user_id, title, body, trade_card(JSON), tags(JSON),
           like_count, comment_count, created_at
post_images id, post_id, position, data(webp base64)
comments   id ULID, post_id, user_id, body, created_at
likes      (post_id, user_id) PK, created_at
reports    id, reporter_id, target_type, target_id, reason, created_at
```

### 2.7 v2 — Twitter/LinkedIn-class social layer (June 2026)

Researched against X and LinkedIn interaction models; shipped in v2:

- **Threaded comments** (one reply level, LinkedIn-style) with **comment likes**.
- **@mention linkification** in posts/comments (plain-text safe; links to profiles)
  - mention notifications.
- **Bookmarks** — private "Saved" feed tab.
- **Follows** — follow from profiles, follower/following counts, **Following feed tab**.
- **Notifications** — bell with unread badge: like, comment, reply, follow,
  mention events; mark-all-read.
- **Reporting v2** — reason categories (spam / harassment / financial advice /
  other) via dialog; **admin Reports queue** with content preview, dismiss and
  delete-content actions.

New tables: `comment_likes`, `bookmarks`, `follows`, `notifications`;
`comments` gains `parent_id` + `like_count`.

### 2.8 Backlog (post-v2)

Quote/repost · edit posts with history · block/mute users · mention autocomplete ·
admin user bans · public profile stats badges (opt-in, verified from journal) ·
weekly digest email · image storage on R2/Vercel Blob · per-post view counts.

---

## 3. Track B — journal improvements from the reference video

Feature matrix extracted from the platform class the video demonstrates
(TradesViz & Indian competitors), mapped against TradeMarkk's journal:

| Feature in the walkthrough/platform class            | TradeMarkk today                | Action                                            |
| ---------------------------------------------------- | ------------------------------- | ------------------------------------------------- |
| Expiry-day vs normal-day analytics                   | ❌ (we already store `expiry`!) | **Shipping now**                                  |
| Psychology/emotion vs P&L analysis                   | partial (emotion tags exist)    | **Shipping now**                                  |
| Total charges paid analytics                         | per-trade only                  | Backlog (easy)                                    |
| AI Q&A over your trades ("win rate on expiry days?") | ❌                              | Backlog — BYO-API-key fits our zero-cost model    |
| AI coach / trade review                              | ❌                              | Backlog (same)                                    |
| Broker auto-sync (Kite Connect etc.)                 | CSV import only                 | Backlog — broker APIs are paid; CSV stays primary |
| Contract-note import (PDF)                           | ❌                              | Backlog                                           |
| Trade replay / simulators / backtesting              | ❌                              | Out of scope — needs market data feeds            |
| Custom dashboard widgets                             | fixed dashboard                 | Backlog                                           |
| Options flow / screeners / dividends                 | ❌                              | Out of scope (live data / non-FnO)                |

**Shipping in this build (data already exists):**

1. **Expiry-day analytics** — options trades taken on expiry day vs other days —
   the classic Indian FnO question, answered with a chart instead of an AI upsell.
2. **Emotions vs P&L panel** — generalize the mistake-cost engine to emotion tags:
   what does trading "anxious" actually cost you?

**Prioritized backlog:** total-charges widget (dashboard) · AI Q&A with user's own
API key (privacy-preserving: query runs client-side against their DB) · contract-note
PDF import · broker auto-sync (paid APIs — opt-in) · custom dashboard widget builder ·
trade replay (needs candle data source).
