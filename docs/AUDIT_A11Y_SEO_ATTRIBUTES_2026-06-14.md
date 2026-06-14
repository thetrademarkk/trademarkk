I'll synthesize the per-unit findings into a single comprehensive Markdown report.

# Exhaustive A11y / Screen-Reader / Attributes / SEO Audit — Synthesis Report

**Branch:** `fix/horizon-intraday-classification` (= main + horizon fix + this audit)
**Scope:** Full route-group + component-directory sweep, line-by-line, across SEO and a11y axes.
**Method:** Every file in each unit's scope was read in full. Prior-report items (A11Y-01..10, SEO-01..08) are confirmed where re-encountered but the focus is the long tail.

> **Note on the prior report filename:** two units reported that `docs/AUDIT_REPORT_2026-06-14.md` does **not** exist on their working branch (they found `docs/AUDIT_FINDINGS.md` / `AUDIT_ROADMAP.md` instead, and one was on `fix/audit-p0-p1`). The A11Y-/SEO- IDs below are therefore mapped by description, not by re-reading the prior file. **Confirm the canonical prior-report path before closing items.**

---

## 1. Executive Summary

### 1.1 Counts by severity

| Severity | Count | Meaning                                                                                                                                                                                    |
| -------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P1**   |    27 | Real SR/SEO breakage (unnamed controls, wrong/duplicate canonical, indexable private surfaces, invisible focus on whole widgets, keyboard-inoperable controls, duplicate/nested `<main>`)  |
| **P2**   |    78 | Degraded but usable (missing aria-invalid wiring, incomplete-tab ARIA, unnamed charts, missing aria-live, label-not-associated, missing h1, color-only state)                              |
| **P3**   |  150+ | Polish/consistency (icon `aria-hidden` gaps, redundant aria, glyph-as-UI, thin/long meta descriptions, missing BreadcrumbList/JSON-LD, focus-ring nits, confirmations of correct patterns) |

(P2/P3 totals are approximate because many P3 lines are explicit "verified-OK" confirmations recorded for coverage.)

### 1.2 Counts by issueType (dominant categories)

| issueType                                                                                 | Approx. count | Where concentrated                                                                                          |
| ----------------------------------------------------------------------------------------- | ------------: | ----------------------------------------------------------------------------------------------------------- |
| `focus` (invisible focus-visible ring)                                                    |           ~35 | community feed/post, ui primitives (Tabs, Dialog), backtesting tabs, blog/toc/cards, settings theme buttons |
| `label-assoc` (orphan `<Label>`, no htmlFor/id)                                           |           ~30 | trade-form, journal-editor, onboarding (byod/setup), playbooks, plan-trade, account/settings forms          |
| `missing-name` (control/chart/input has no accessible name)                               |           ~25 | icon-only buttons, unnamed Selects, recharts charts, theme swatches, tag inputs                             |
| `aria-invalid-misuse` (no aria-invalid/describedby; fake tabs; fake radiogroups; listbox) |           ~24 | all form validation, admin/community/backtesting incomplete tablists, radiogroups                           |
| `live-region` (async updates not announced)                                               |           ~22 | admin loaders, monte-carlo, report period switch, follow/DM/typing, migration, recompute                    |
| `emoji-glyph` (raw ✓✗×→∞⌘⋯≥≤ as UI, violates lucide-only)                                 |           ~22 | compare table, adherence, streak, migration, trade-detail, reports, backtesting steps                       |
| `heading-order` (no h1, CardTitle-is-div, h2 before h1)                                   |           ~16 | community home + post-detail, dashboard, CardTitle systemic, onboarding                                     |
| `color-only` (state via hue alone)                                                        |           ~16 | PnlText/StatCard, direction/confidence toggles, tag-chip, heatmaps                                          |
| `canonical` / `robots-index` / `sitemap` (SEO)                                            |           ~20 | community layout canonical leak, private surfaces indexable, sitemap gaps, metadataBase localhost fallback  |
| `role` / `landmark` (wrong/missing roles, unnamed/duplicate landmarks)                    |           ~14 | duplicate `<main>` admin, unlabeled `<aside>`/`<nav>`, menu-in-menu, tables without scope                   |
| `meta-title` / `meta-description` / `opengraph` / `json-ld` / `twitter` (SEO meta)        |           ~25 | profiles/posts no metadata, long descriptions, missing Article image, no community JSON-LD                  |
| `link-rel` (`target=_blank` rel inconsistency)                                            |            ~8 | three different incomplete rel values site-wide                                                             |
| `keyboard` (mouse-only / hover-gated / window.prompt)                                     |            ~9 | 2FA window.prompt, hover-gated delete buttons, video click, radiogroups                                     |

### 1.3 Systemic patterns (the headline story)

These few root causes generate the majority of findings. **Fixing the primitive fixes dozens of leaf findings.**

1. **No global `:focus-visible` fallback + primitives that strip the outline.** `src/styles/globals.css` has zero focus/outline rules (verified). `TabsTrigger` (`tabs.tsx:31`) and `Dialog` close (`dialog.tsx:27`) use `focus-visible:outline-none` / `focus:outline-none` with **no replacement ring**, and dozens of hand-rolled `<button>`/`<Link>` across community, blog, settings, backtesting, admin nav use custom classNames with no ring. → **~35 findings, including 3 P1s.**
2. **`CardTitle` renders a `<div>`, not a heading** (`card.tsx:17`). Every section title across analytics, insights, reports, dashboard, settings, account, admin, rules is therefore invisible to heading navigation. → **systemic P2 touching every Card consumer.**
3. **Bare Radix `<Label>` does not auto-associate** (`label.tsx`). The repo's dominant form pattern is sibling `<Label>` + `<Input>` with no `htmlFor`/`id`, so most form fields are unnamed and labels are non-clickable. Worst in trade-form, onboarding, account/settings. → **~30 label-assoc findings + many unnamed inputs.** The `Label` default color is also `text-muted` (~4.40:1, below AA — A11Y-09's propagation point).
4. **Form validation has no programmatic wiring.** No consumer sets `aria-invalid` / `aria-describedby` on error, and `Input`/`Textarea` primitives ship no `aria-invalid:` error style. Errors are red-text-only, often without `role=alert`. → **~24 findings.**
5. **Community layout canonical leak** (`community/layout.tsx:14` hardcodes `alternates.canonical: '/community'`). All child routes lacking their own canonical (post, profile, leaderboard, messages, notifications) silently emit `canonical=/community`. → **drives 4 P1 SEO findings.** (Maps to prior SEO-01/SEO-05/SEO-08.)
6. **Private personal surfaces are indexable.** `/community/messages`, `/community/notifications`, `/reset-password` ship no metadata and no `robots:noindex`; `robots.ts` disallows only `/app` and `/api`. → **3 P1 SEO findings.** (Maps to prior SEO-05/SEO-06.)
7. **recharts charts have no accessible name.** Hero equity, walk-forward, compare overlay, pulse/admin trend bars are bare SVGs (the hand-rolled SVGs are done right). → **~6 findings.** (Maps to prior A11Y-03.)
8. **Raw glyphs used as UI** (violates lucide-only): ✓ ✗ × → ∞ ⌘ ⋯ ≥ ≤ ★ −/+ \* across compare table, rules, streak, migration, trade-detail, reports, backtesting steps. → **~22 findings.** (Maps to prior A11Y-06.)
9. **Incomplete ARIA tabs** (`role=tablist`/`tab`/`aria-selected` with no `tabpanel`, no `aria-controls`, no roving tabindex, no arrow keys) repeated in symbol-stream, sentiment-gauge, tag-page, mode-explorer, and all three admin filter bars — while `trending-board` and `setup-form` deliberately got the `role=group`+`aria-pressed` pattern right. → **~8 findings.**
10. **metadataBase localhost fallback vs hardcoded canonical host.** `siteConfig.url` falls back to `http://localhost:3000`; `middleware.ts` hardcodes `thetrademarkk.com`. Two sources of truth, no guard. → silent catastrophic-SEO risk if the prod env var is wrong.

---

## 2. ALREADY being fixed by in-flight workers (prior A11Y-/SEO- IDs)

These were **re-encountered and confirmed still present** but map to prior enumerated items currently being addressed. Listed for confirmation only — do not double-assign.

| Prior ID                     | Confirmation (path:line)                                                                                                                                                                                                                 | Note                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **A11Y-02**                  | `tabs.tsx:31` TabsTrigger `focus-visible:outline-none`, no ring                                                                                                                                                                          | CONFIRMED. Highest-leverage primitive fix.                                                |
| **A11Y-08**                  | `dialog.tsx:27` Dialog close X `focus:outline-none`, no ring                                                                                                                                                                             | CONFIRMED.                                                                                |
| **A11Y-03**                  | `charts/trend-charts.tsx:43-66` recharts no role/aria-label; re-confirmed at `pulse-sections.tsx:27,50` and `overview-section.tsx:81`; extends to `hero-equity-chart.tsx:60`, `walkforward-curve.tsx:30`, `compare-overlay-chart.tsx:31` | CONFIRMED + extended; also keyboard tooltip gap.                                          |
| **A11Y-01**                  | Root cause at `input.tsx` / `label.tsx` / `textarea.tsx` (no aria-invalid styling; bare Label)                                                                                                                                           | CONFIRMED at primitive root.                                                              |
| **A11Y-04**                  | `pnl-text.tsx`, `stat-card.tsx` color signal (mitigated by signed values)                                                                                                                                                                | Confirmed; the color-blind-safe toggle in `appearance-section.tsx` is the product remedy. |
| **A11Y-06**                  | Raw glyphs: `post-card.tsx:288` (⋯), `compare/tradezella-alternative` (✓/✗)                                                                                                                                                              | CONFIRMED + large untracked set enumerated below.                                         |
| **A11Y-09**                  | `label.tsx` defaults to `--text-muted` (~4.40:1); `.micro-label` same token                                                                                                                                                              | CONFIRMED propagation point.                                                              |
| **SEO-01 / SEO-05 / SEO-08** | `community/layout.tsx:14` canonical leak → post/profile/leaderboard/messages/notifications                                                                                                                                               | CONFIRMED root cause.                                                                     |
| **SEO-02**                   | `sitemap.ts` omits `/backtesting`, `/backtesting/explore`, `/community/trending`; still uses static `POSTS` so approved community blog posts never listed                                                                                | CONFIRMED.                                                                                |
| **SEO-06**                   | `robots.ts:6` disallows only `/app`,`/api`; private community + reset-password surfaces open                                                                                                                                             | CONFIRMED.                                                                                |
| **SEO-07**                   | `site.ts:45-57` `webSiteJsonLd()` doc-comment claims a SearchAction but emits none                                                                                                                                                       | CONFIRMED.                                                                                |

---

## 3. NEW long-tail findings by AREA

Within each area: P1 first, then P2, then P3. Format — `file:line · element · issueType · detail → fix`.

### 3.1 SEO — Marketing

**P2**

- `src/config/site.ts:9-10` · `siteConfig.description` · meta-description · 251 chars; truncates in every SERP/unfurl and is reused on home page + SoftwareApplication JSON-LD. → Trim to ≤160; give home its own concise description.
- `src/app/(marketing)/blog/[slug]/page.tsx:30` · not-found branch · robots-index · Returns `{}` → inherits homepage canonical/OG, no noindex on 404. → Return `{ title: 'Article not found', robots: { index: false } }`.
- `src/app/(marketing)/compare/tradezella-alternative/page.tsx:14-23` · table cells · emoji-glyph · Raw ✓/✗; bare `✗` cell has no text equivalent. → lucide Check/X + sr-only Yes/No, or plain words.
- `src/app/sitemap.ts:9-20,28-33` · staticPages + blog POSTS · sitemap · Approved community blog articles (via `listBlogPosts()`) never enter sitemap. → Make export async, await `listBlogPosts()`; add backtesting + community sub-routes.

**P3**

- `features/page.tsx:6-8` (235-char desc), `changelog/page.tsx:5` (25-char thin desc) · meta-description · Out of length sweet-spot.
- `blog/[slug]/page.tsx:34-40,49-61` · opengraph/json-ld · Article missing `authors`/`tags`, `image`, `dateModified`, `publisher.logo`.
- `site.ts:11` · metadataBase · canonical · localhost fallback vs hardcoded host in `middleware.ts:15`; no guard.
- `changelog`, `docs`, `features` · json-ld · No SoftwareApplication / BreadcrumbList / ItemList.
- `privacy/page.tsx:87`, `terms/page.tsx:51` · other · Hardcoded "Last updated" date, no `<time dateTime>`.
- `(marketing)/page.tsx:16` · meta-title · Home title 64 chars (slightly over ~60).
- `features/page.tsx:56` · CTA links `/app/dashboard` (Disallowed) instead of `/app/onboarding` (inconsistency, harmless).

**Verified OK:** every marketing route has unique title + self-canonical; FAQPage + home @graph well-formed; demo poster alt descriptive; decorative SVGs aria-hidden; single h1 per page.

### 3.2 SEO — Community routes

**P1**

- `community/messages/page.tsx:74` · robots-index · Private DM inbox fully INDEXABLE (client page, no metadata, not disallowed). → Add server `layout.tsx` exporting `robots:{index:false,follow:false}` + title.
- `community/notifications/page.tsx:18` · robots-index · Same as messages. → Same fix.
- `community/u/[username]/page.tsx:1` · meta-title/canonical/opengraph · NO generateMetadata; every profile inherits title "Community" + `canonical=/community` + no OG. Worst offender. → Add async generateMetadata (model on `s/[symbol]`).
- `community/post/[id]/page.tsx:20` · canonical · Never sets `alternates.canonical` → every post declares `/community` as canonical; OG missing url+type. → Set per-post canonical + `openGraph.url`/`type:'article'` + twitter.
- `community/community-home.tsx:107` · heading-order · `/community` landing has NO `<h1>` (only h2s). → Add sr-only/visible `<h1>`.

**P2**

- `community/layout.tsx:14` · canonical · ROOT CAUSE — hardcoded `alternates.canonical:'/community'` inherited by all children. → Remove from layout; each page owns its canonical.
- `community/leaderboard/page.tsx:33` · meta-title · Client page, no metadata → inherits "Community" + wrong canonical. → Add `layout.tsx` (model on trending).
- `robots.ts:6` · robots-index · Doesn't disallow `/community/messages`, `/community/notifications`. → Add both.
- `community/page.tsx:6` · json-ld · No community route emits any structured data (Organization/WebSite/DiscussionForumPosting/ProfilePage/BreadcrumbList). → Add via existing `site.ts` helpers.

**P3**

- `post/[id]/page.tsx:32` (not-found no noindex, soft-404), `s/[symbol]/page.tsx:36` (twitter summary crops OG image), `page.tsx:11` (OG title/desc fall back to homepage copy), `sitemap.ts:8` (trending/leaderboard absent), `layout.tsx:11` (mixed title-template conventions risk double-branding).

**Verified OK:** `s/[symbol]` and `t/[tag]` are the correct reference (title/desc/canonical/OG/twitter all present; `t/[tag]` notFound() on junk).

### 3.3 SEO — Backtesting routes

**P1**

- `sitemap.ts:8-20` · sitemap · `/backtesting` + `/backtesting/explore` (both indexable) absent. (= SEO-02.) → Add to staticPages.

**P2**

- `backtesting/page.tsx:5-11` · json-ld · Flagship landing emits zero structured data (SoftwareApplication/WebApplication candidate). → Add via `jsonLdScript()`.
- `r/[shareId]/page.tsx:38-44` · opengraph · Most-shareable route omits `url` + `images`. → Add url; consider dynamic per-share OG image (strategy + net P&L already computed).
- `site.ts:11` · canonical · metadataBase localhost fallback (same systemic risk).

**P3**

- `explore` no ItemList/BreadcrumbList; `r/[shareId]` no per-share twitter + not-found branches missing noindex; `code` noindex placeholder (defensible, re-evaluate); `page.tsx:6` bare "Backtesting" title (thin).

**Verified OK:** every backtesting child correctly overrides `alternates.canonical` (layout canonical is benign); robots noindex correct per route; single h1 each; no content `<img>`.

### 3.4 SEO — App / Admin / Auth (privacy + hygiene)

**P1**

- `reset-password/page.tsx:102` · robots-index · NO metadata, under root layout (no noindex), not in robots disallow → token-gated reset page fully indexable on prod host. → Add `metadata` with `robots:{index:false,follow:false}`.
- `community/layout.tsx:14` · canonical · (cross-referenced) canonical-leak bug class.

**P2**

- `site.ts:11` · canonical · metadataBase env-var risk vs `middleware.ts` CANONICAL_HOST; document coupling + add CI assertion.

**P3**

- `admin/page.tsx:12` & `offline/page.tsx:4` · robots-index · `index:false` but missing `follow:false`.
- `app/layout.tsx:9` · meta-title · Every `/app/*` route shares "App · TradeMarkk" (UX/SR title hygiene).
- `app/dashboard/page.tsx:114` & `onboarding/page.tsx:6` · heading-order · Dashboard has no h1 (Greeting is h2); onboarding hosted/byod steps render no h1.
- `robots.ts:6` · Add `/admin`, `/reset-password`, `/offline` for defense-in-depth.

**Verified OK:** `app/layout.tsx` sets `robots:{index:false,follow:false}` inherited by all `/app/*`; `trades/[id]` correctly noindex; no app page leaks a /community canonical.

### 3.5 A11y — UI primitives + shared + layout

**P1**

- `ui/tabs.tsx:31` · TabsTrigger · focus · No replacement ring; invisible focus on every tab. (= A11Y-02) → Add `focus-visible:ring-2 focus-visible:ring-accent`.
- `ui/dialog.tsx:27` · close X · focus · No ring. (= A11Y-08) → Same.
- `shared/feedback-dialog.tsx:80-87` · trigger `<span onClick>` · keyboard · Non-focusable trigger; fragile for non-button children. → Use `DialogTrigger asChild` / real button.

**P2**

- `layout/sidebar.tsx:71-94,97-101` · missing-name · Collapsed nav links + collapse toggle are nameless (rely on tooltip = description). → Add `aria-label` when collapsed + on toggle.
- `layout/topbar.tsx:133-138` · missing-name · Storage/settings dropdown trigger is nameless icon button. → `aria-label`.
- `layout/command-palette.tsx:48-51` · label-assoc · cmdk input has placeholder only, no name. → `aria-label="Search commands"`.
- `layout/unlock-screen.tsx:40-47` · label-assoc/live-region · Passphrase Input unlabeled; error not `role=alert`, no `aria-invalid`/`aria-describedby`. → Label + alert + invalid wiring.
- `ui/label.tsx:11-16` · label-assoc · Default `text-muted` (~4.40:1) on every form label. (= A11Y-09) → Default to `text-foreground` or bump token.
- `ui/input.tsx:4-15` & `ui/textarea.tsx` · aria-invalid-misuse · No `aria-invalid:` error styling hook. (= A11Y-01 root) → Add `aria-invalid:border-loss aria-invalid:ring-loss`.
- `ui/dialog.tsx:36-38` · aria-invalid-misuse · No enforced DialogTitle. → Document/assert.
- `shared/pnl-text.tsx:15-25`, `shared/stat-card.tsx:30-37` · color-only · When `signed=false`, direction is hue-only. → Always encode sign/arrow.
- `charts/trend-charts.tsx:43-66` · role/keyboard · No role=img/aria-label; tooltip mouse-only. (= A11Y-03) → Wrap role=img + summary + data-table alternative.
- `ui/rich-editor.tsx:152,69-74,179-181` · missing-alt/keyboard/aria-invalid-misuse · Forces `alt=''` on all images; `window.prompt` for links; `dangerouslySetInnerHTML` unsanitized. → Alt prompt, in-app link dialog, sanitize.
- `shared/feedback-dialog.tsx:95-113` · aria-invalid-misuse · `role=radiogroup` with plain buttons, no roving tabindex/arrow keys.
- `bottom-nav.tsx:73`, `sidebar.tsx:76`, `site-header.tsx:43` · link-rel · Three different incomplete `rel` values on `target=_blank`. → Standardize `rel="noopener noreferrer"`.
- `shared/empty-state.tsx:19-22` · heading-order · Unconditional `<h3>` skips h2 under page h1; decorative Icon not aria-hidden. → Configurable level + aria-hidden.

**P3 (high volume — primitives that invite misuse + consistency):** `ui/skeleton.tsx` (no role=status), `ui/progress.tsx`/`ui/slider.tsx`/`ui/checkbox.tsx`/`ui/switch.tsx` (no default name — consumer audit), `ui/table.tsx` (no `scope`, no caption, scroll region not keyboard-reachable), `ui/date-time-picker.tsx` (calendar day cells/month-nav/Done no focus ring; ambiguous single-letter WEEKDAYS), `topbar.tsx:117` (⌘K glyph), `topbar.tsx:150-158` (theme active state by opacity only), `app-shell.tsx`/`sidebar.tsx:54` (unlabeled nav landmark), `error-fallback.tsx:34` (navigation as button not link), `select.tsx:18` (`focus:` not `focus-visible:`), `dropdown-menu.tsx:46` (Label as raw div).

### 3.6 A11y — Community (feed/post/composer)

**P1**

- `community-home.tsx` / `post-detail.tsx:87-113` / `comment-section.tsx:298` · heading-order · Post-DETAIL page has no `<h1>` (post title is h2); feed page no h1. → Pass `detail` flag so PostCard title becomes h1; sr-only h1 for titleless posts; ensure single `<main>`.

**P2 — systemic missing focus-visible ring** (hand-rolled controls; primitives have the ring, these don't):

- `post-card.tsx` (255-279 follow, 281-289 & 466-474 dropdown triggers, 368-374 show-more, 442-464 bookmark/comments/share + all inline author/ticker/tag links), `comment-section.tsx` (67-72 show-anyway, 186-229 like/reply/edit/delete), `community-search.tsx:198-207` (clear), `composer.tsx:189-227` (topic chips, remove-image), `sentiment-toggle.tsx`, `sentiment-gauge.tsx:34-48`, `who-to-follow.tsx`/`starter-suggestions.tsx`/`watchlist-rail.tsx` (follow/dismiss/unwatch), `inline-composer.tsx`, `community-home.tsx:115-150` (feed tabs/chips/FAB), `post-detail.tsx:89-94` (back link). → One shared link/button focus class, or sweep.

**P2 — ARIA correctness:**

- `sentiment-gauge.tsx:32-49` · aria-invalid-misuse · `role=tablist`/`tab` with no tabpanel/roving (trending-board deliberately avoided this). → `role=group`+`aria-pressed`.
- `report-dialog.tsx:63-81` · keyboard · `role=radiogroup` with no arrow-key roving. → Implement roving tabindex or native radios.
- `reputation-chip.tsx:38`, `award-badges.tsx:69,210` · role · `TooltipTrigger asChild` on non-focusable `<span>` → tooltip keyboard/touch-unreachable (sr-only text mitigates SR). → `tabIndex={0}` + focus ring.
- `post-card.tsx:344-357` · heading-order · Title always h2; titleless posts render no heading on detail.

**P3:** `post-card.tsx:288` (⋯ glyph = A11Y-06), generic image alt (acceptable fallback), `feed.tsx:101`/`for-you-feed.tsx:31` (error not role=alert), reaction-picker no focus-restore on close, community-search Clear button inside listbox, related-posts/quoted-post orphan bare-number counts, comment replies not a nested `<ul>`.

### 3.7 A11y — Community (dm/profile/social)

**P2**

- `s/[symbol]/symbol-stream.tsx:96`, `sentiment-gauge.tsx:32`, `t/[tag]/tag-page.tsx:99` · aria-invalid-misuse · Three incomplete tablists (tag-page additionally puts a `<Button>` as direct child of tablist). → `role=group`+`aria-pressed` (model on trending-board).
- `community-home.tsx:202` · heading-order · `/community` no h1.

**P3:** unlabeled `<aside>` ×2 + ungrouped toggle clusters; leaderboard podium DOM order 2/1/3 (reading order off); icon-only streak/award badges rely on `title=` with no sr-only; `notifications-bell` Bell / `site-header` Github / `community-search` X & Search / `message-thread` ArrowLeft missing `aria-hidden`; community-search status rows + events/trending loading + DM typing/incoming-message live regions won't announce (no role=status / mounted-with-content); stale "Follow {name}" aria-labels after toggle; `notifications/page.tsx:79` aria-expanded without aria-controls.

### 3.8 A11y — Trades + Journal + Calendar

**P1**

- `ui/label.tsx:10-16` · label-assoc · ROOT CAUSE (bare Label, no auto-assoc).
- `trade-form.tsx` · label-assoc · Symbol(231), Strike(347), Qty(431), Entry(449), Exit(470), Stop/Target/Planned(509-527), Playbook select(529 — no aria-label at all), Notes(582) all unlabeled/unnamed. → htmlFor/id or aria-label per field/leg.
- `trade-form.tsx:237,293,359,442,461` · aria-invalid-misuse · No input sets aria-invalid/aria-describedby; errors color-only. → Wire all.
- `trade-form.tsx:316-327` · role/keyboard · "Remove leg" `<span role=button onClick>` nested INSIDE a `<button>`, no tabIndex/onKeyDown → keyboard-inoperable + invalid nesting. → Sibling real button.
- `trade-detail.tsx:228-231` · emoji-glyph · Confidence as `"★".repeat(n)` → lucide Star + numeric.
- `trade-detail.tsx:322-327` · missing-name · Attachment delete icon button has no name AND is hover-gated (keyboard-unreachable). → aria-label + show on focus.
- `journal-editor.tsx:158-163,224-229` · label-assoc · Three journal Textareas + "Followed my plan?" Switch unnamed.

**P2:** trade-form Segment/Product/Direction/Confidence groups not grouped (no role=group/aria-labelledby; Direction/Confidence color-only, no aria-pressed); live P&L preview no aria-live; `trade-detail` h1 + non-heading CardTitles; `trades-table.tsx:58-66` clickable `<tr>` (Enter-only, no role=button, nested checkbox, no focus ring); `csv-import.tsx:160-179` six unnamed mapping selects + dialog trigger not in `DialogTrigger` (no focus restore); `tag-picker.tsx:36-49` color-only selected (no aria-pressed); `month-heatmap.tsx:81-115` in-cell P&L unsigned (color-only for sighted) + journaled dot color-only; `trade-filters.tsx` `≥`/`≤` glyphs in chips, Radix-Checkbox-in-`<label>` naming gap, `MultiList` options may be unnamed.

**P3:** trade-detail `→` glyph; lot-qty-helper hardcoded ids (multi-leg risk); journal Flame not aria-hidden; journal day-nav chevrons unnamed.

**Verified OK (reference patterns):** lot-qty-helper (htmlFor/id + aria-live result), trade-cards selection card (role=button + Enter AND Space + aria-pressed), journal mood buttons, heatmap aria-labels (signed + journalled suffix), PnlText always signed.

### 3.9 A11y — Analytics + Dashboard + Insights + Reports

**P2**

- `ui/card.tsx:17` · heading-order · CardTitle `<div>` — **single highest-leverage finding for this unit**; every section title across all four areas invisible to heading nav. → Configurable heading element.
- `day-time-heatmap.tsx:105` & tax tables (`tax-report-view.tsx:208`) · role · `<th>` without `scope`, row labels as `<td>`, no caption/aria-label. → scope=col + th scope=row + caption.
- `monte-carlo.tsx:96,174` · live-region · Async run + error not announced (no role=status/alert). → Add live regions.
- `report-view.tsx:99,160` · label-assoc/live-region · Period-kind Select unnamed (FY Select got a label, this didn't); period switch / Previous-Next re-renders silently. → aria-label + aria-live.
- `hero-equity-chart.tsx:60`, `walkforward-curve.tsx:30`, `compare-overlay-chart.tsx:31` · missing-name · recharts charts unnamed (= A11Y-03). → role=img + summary.
- `pulse-sections.tsx:34-37` · color-only · Views-chart series mapped by color only (chart itself unnamed).

**P3:** report-view `←`/`→`/`∞`/`×` glyphs; recent-trades/open-positions `→` glyphs; report/tax export icons missing aria-hidden; `horizon-stats.tsx:48` breakdown only in `title=`; `kpi-row.tsx:65` KPI link purpose unclear; `greeting.tsx:14` h2 (verify page h1).

**Verified OK:** all chart-aria.ts summaries present; StatCard sr-only value; PnlText signed; tax disclaimer `role=note`; FY Select labeled.

### 3.10 A11y — Backtesting components

**P1**

- `ui/tabs.tsx:31` · focus · Invisible focus on strike-ladder mode tabs + results evidence tabs. (= A11Y-02)
- `strike-ladder.tsx:126-144` · aria-invalid-misuse · `role=listbox` with independently-focusable `role=option` buttons (double-focus, no aria-activedescendant, no roving). → One model: container + tabIndex=-1 options + activedescendant, or radiogroup.

**P2:** `setup-step.tsx:89` (✓ glyph), `timing-step.tsx:91`/`risk-step.tsx:81,197` (−/+ glyphs), `returns-tab.tsx:98` (U+2212), `mobile-payoff.tsx:26-27` (∞ vs desktop "Unlimited" + color-only) — all emoji-glyph; `quality-chip-row.tsx:89` (one chip missing focus ring); `builder-shell.tsx:160-168` (error list not role=alert, not wired to Continue); `setup-step.tsx:62-95` (single-select groups as aria-pressed; Segmented Buy/Sell + CE/PE have no group name); `mobile-payoff.tsx:58-64` (duplicate "Live payoff" title + no Sheet description + double-announced chart); `hero-equity-chart`/`walkforward-curve`/`compare-overlay-chart` unnamed (= A11Y-03); `preset-card.tsx:107-119` (aria-disabled button with no-op onClick).

**P3:** `explore-grid.tsx:126-135` (facet rows not grouped), `stepper.tsx:82-94` (mobile progress bar no role=progressbar), `results-view.tsx:124` (running progress not live), `save-share-bar.tsx:184-199` (share-link reveal not live), `walkforward-curve.tsx:89` (OOS → glyph), `trade-blotter.tsx`/`trade-quick-view.tsx` (\* glyph + title-only), `builder-shell.tsx:181` (unnamed aside).

**Verified OK:** icon-only buttons all have aria-label; hand-rolled SVGs role=img; review-step role=status; single `<main>`; heading order correct.

### 3.11 A11y — Marketing components + Pulse + Blog

**P1**

- `pulse-sections.tsx:27,50` · missing-name · DailyBars/DailyViewsArea charts unnamed on public Pulse. (= A11Y-03, root in trend-charts.)

**P2**

- `demo-video.tsx:84-87` · other · `<video>` has no `<track kind=captions>`; next encode adds audio → WCAG 1.2.2. → Add VTT + CC toggle + transcript.
- `mode-explorer.tsx:68` · aria-invalid-misuse · `role=tablist`/`tab` with no tabpanel/aria-controls/ids. → Complete pattern or radiogroup.
- `toc.tsx:43-54`, `blog/page.tsx:38-72`, `blog/[slug]/page.tsx:81-168,142-146` · focus · TOC buttons, post-card links, rail/breadcrumb/CTA links, heading self-anchors — all no focus-visible ring (no global rule). → Global `:focus-visible` base rule fixes all.
- `pulse-sections.tsx:34-37` · color-only · Views legend color-mapped (chart unnamed).
- `submit-form.tsx:103-107` · live-region · Form error static `<p>`, no role=alert, no aria-invalid/describedby.
- `blog/write/page.tsx` + `submit-form.tsx:93-101` · label-assoc · "Article" RichEditor label orphaned (no htmlFor/id).

**P3:** `hero-showcase.tsx:190` (Check not aria-hidden + color-only rules), `community-spotlight.tsx:26-28` (raw `·` bullets read aloud), `feature-bento.tsx:50-67` (CostTicker NumberFlow not aria-hidden, churns), `mode-explorer.tsx:55` (redundant aria-label), `demo-video.tsx:64-83` (click-to-toggle on non-focusable video), `toc.tsx:38` (no aria-current on scroll-spy).

**Verified OK:** reveal/cursor-effects/returning-user-redirect clean; progress-bar correctly aria-hidden; vital-cards gauge aria-hidden + text rating; FeatureBento h3 order correct; community-spotlight mock aria-hidden.

### 3.12 A11y — Account + Settings + Auth

**P1**

- `settings/account-section.tsx:53-69` · label-assoc · Account name / Broker select / Starting capital all orphan labels/unnamed.
- `settings/appearance-section.tsx:39-63` · missing-name · Theme swatch buttons: selection state color-only, no aria-pressed/checked.
- `settings/tags-section.tsx:90-92` · missing-name · Icon-only add-tag `<Plus>` button, no name.
- `account/two-factor-section.tsx:93,108` · keyboard · `window.prompt()` for 2FA disable + regenerate (inaccessible native dialog; repo replaced confirm() but not these). → In-app password Dialog.

**P2:** appearance theme buttons no focus ring + Theme label/Switch unassociated; tags-section new-tag input + kind Select unnamed + delete button hover-gated (keyboard-unreachable); 2FA OTP label orphaned + fresh backup codes no focus-move/live-region; `sessions-section.tsx:147-159` non-unique "Revoke"/"Sign out" names + loading not announced; `change-email`/`change-password` have role=alert but no aria-invalid/aria-describedby; `auth-form.tsx` 2FA/OTP/main errors missing role=alert + notice success not announced + MailCheck not aria-hidden + form starts at h2 (no h1); `otp-input.tsx:80-107` no completion/clear live-region, no focus-reset on error; `storage-section.tsx:89-111` restore file input unnamed + non-button trigger; `recompute-charges-section.tsx:114-129` result banners not role=status; `card.tsx` CardTitle-as-div (all 11 section titles).

**P3:** reveal toggle `tabIndex={-1}` (keyboard-excluded); danger-zone title color-only (no icon); various download actions no SR feedback.

**Verified OK:** Input/Button/Switch/Select carry focus rings; Radix Dialog focus trap; QrCode role=img + text fallback; delete-account/2FA-enable use in-app ConfirmProvider; daily-prompts-widget is the correct label-assoc reference.

### 3.13 A11y — Rules + Workflow + Goals + Onboarding + Playbooks + Streak + Migration

**P1**

- `adherence-panel.tsx:37` · emoji-glyph · `{followed}✓ {broken}✗` raw glyphs, meaning carried by glyph only.
- `daily-checklist.tsx:51-64` · aria-invalid-misuse · Tri-state status buttons use `title=` only ('na' opaque), no radiogroup/aria-pressed, selection color-only, no aria-live.
- `byod-wizard.tsx:106-147` · label-assoc · DB URL / token / passphrase / import-key all orphan labels (two are password). Core onboarding.
- `setup-form.tsx:170-196` · label-assoc · Name / Broker select / capital / risk all orphan labels. Core onboarding.
- `streak-indicator.tsx:124` & `mode-switch-wizard.tsx:220` · emoji-glyph · Raw ✓ as success indicator.

**P2:** adherence per-rule Progress unnamed; daily-checklist broken-state color-only; `rules-manager.tsx:61-71` new-rule input + category select unnamed + generic per-rule Switch/Edit/Delete names; `plan-trade-dialog.tsx:150-196` orphan labels + direction toggle color-only no aria-pressed; `goals-section.tsx:53-101` no validation feedback (values silently dropped); `playbooks-panel.tsx:186-209` orphan labels; `shortcuts-help.tsx:44` symbol-only `<kbd>` keys (verify shortcutHelpRows for ⌘/⌥/⇧); `byod-wizard.tsx:16` `rel=noreferrer` only; `onboarding-flow.tsx:281` h2-before-h1 / no-h1 on later steps + mode cards busy-name confusion; `streak-indicator.tsx:96-110` milestone badges title-only + earned color-only; `streak-indicator.tsx:80` / `template-menu.tsx:84-94` interactive content inside `role=menu`; `mode-switch-wizard.tsx:202-214` migration progress/done not live + Progress unnamed.

**P3:** `×{count}` glyphs in emotions/mistakes panels; rules-list mutations not announced; `bulk-action-bar.tsx` floating bar no role=toolbar + 0→1 selection may not announce; `template-menu`/`template-manager` rename inputs unnamed; playbooks `<pre>` semantic mismatch + generic Edit/Delete names.

**Verified OK:** daily-prompts-widget (htmlFor association), setup-form trader-type cards (fieldset/legend + aria-pressed — reference), streak trigger button (descriptive aria-label), onboarding auto-connecting loader (role=status), risk-banner (role=alert), weekly-goals Progress (aria-label).

### 3.14 A11y — Admin

**P1**

- `admin-shell.tsx:83` (nested in `page.tsx:48`) · landmark · TWO `<main>` landmarks (nested). → Inner becomes `<div>`/`<section>`; single main.

**P2:** three invalid tablists — `reports-section.tsx:230` (SegTabs), `submissions-section.tsx:62`, `feedback-section.tsx:24` (+ fused "bug 3" name); `overview-section.tsx:33,81` (loading skeleton no role=status; DailyBars chart unnamed — = A11Y-03); `reports-section.tsx:97` (mod-queue load/refetch silent).

**P3:** submissions/feedback loaders not live; `reports-section.tsx:322` `rel=noopener` only + no new-tab hint; category/suspended badges color-leaning (text present, OK-ish); sort toggle name doesn't convey toggle; `empty-state.tsx:21` Icon not aria-hidden (affects all admin empties); recent-signups table no caption/aria-label; nav count badges fused name + bare `<button>` may lack focus ring; `<details>` renders untrusted submission HTML (content risk).

**Verified OK:** real buttons/links throughout; aria-current on active nav; in-app Radix confirm with focus trap; no native confirm; no positive tabindex.

---

## 4. Batched FIX PLAN (ordered by leverage)

Batches within the same number are **file-disjoint and can run in parallel**. Later batches depend on earlier primitive changes landing first.

### BATCH 0 — Systemic primitive fixes (highest leverage; land first)

These are single-file edits that each resolve many leaf findings. **Run all in parallel** (different files), but they unblock per-area sweeps.

| #   | File                                                   | Change                                                                                               | Resolves                                                                                              |
| --- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 0a  | `src/styles/globals.css`                               | Add a global `:focus-visible` ring base rule for bare `<a>`/`<button>`                               | ~20 hand-rolled focus findings (community, blog, toc, settings theme, admin nav, backtesting)         |
| 0b  | `src/components/ui/tabs.tsx`                           | Add `focus-visible:ring-2 focus-visible:ring-accent` to TabsTrigger                                  | A11Y-02 + strike-ladder + evidence tabs                                                               |
| 0c  | `src/components/ui/dialog.tsx`                         | Replace `focus:outline-none` on close X with focus-visible ring; document required DialogTitle       | A11Y-08 + dialog naming                                                                               |
| 0d  | `src/components/ui/card.tsx`                           | Make `CardTitle` a configurable heading (`as`/level prop), default safe                              | **Every** Card section title across analytics/insights/reports/dashboard/settings/account/admin/rules |
| 0e  | `src/components/ui/label.tsx`                          | Default to `text-foreground` (or bump `--text-muted` to ≥4.5:1); document htmlFor requirement        | A11Y-09 + all label contrast                                                                          |
| 0f  | `src/components/ui/input.tsx` + `textarea.tsx`         | Add `aria-invalid:border-loss aria-invalid:ring-loss` base style                                     | A11Y-01 root; makes all form error wiring "free"                                                      |
| 0g  | `src/components/charts/trend-charts.tsx`               | Wrap charts in role=img + data summary; gate animation by reduced-motion; add data-table alternative | A11Y-03 (pulse + admin + reused everywhere)                                                           |
| 0h  | `src/components/shared/pnl-text.tsx` + `stat-card.tsx` | Ensure non-chromatic sign always rendered when `signed=false`                                        | A11Y-04 propagation                                                                                   |

### BATCH 1 — SEO infrastructure (file-disjoint from BATCH 0; parallelizable internally)

| #   | Files                          | Change                                                                                                          |
| --- | ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 1a  | `src/app/community/layout.tsx` | Remove `alternates.canonical` (canonical-leak root) → unblocks community per-route canonicals                   |
| 1b  | `src/config/site.ts`           | Trim `description` ≤160; add SearchAction or delete claim (SEO-07); add build/runtime host assertion            |
| 1c  | `src/app/sitemap.ts`           | Make async; `await listBlogPosts()`; add `/backtesting`, `/backtesting/explore`, `/community/trending` (SEO-02) |
| 1d  | `src/app/robots.ts`            | Disallow `/community/messages`, `/community/notifications`, `/reset-password`, `/admin`, `/offline` (SEO-06)    |

### BATCH 2 — Private-surface noindex + per-route metadata (depends on 1a for canonicals)

Each is a distinct route/layout file — parallelizable:

- `community/messages/layout.tsx` (new) + `community/notifications/layout.tsx` (new) — noindex + title (P1)
- `community/u/[username]/page.tsx` — add generateMetadata (P1)
- `community/post/[id]/page.tsx` — canonical + OG url/type + twitter + not-found noindex (P1)
- `community/leaderboard/page.tsx` (or new layout) — metadata (P2)
- `reset-password/page.tsx` — noindex metadata (P1)
- `backtesting/page.tsx`, `backtesting/r/[shareId]/page.tsx` — JSON-LD + OG url/images (P2)
- `blog/[slug]/page.tsx` — not-found noindex + Article image/dateModified/publisher.logo (P2/P3)
- `(marketing)/compare/.../page.tsx` — replace ✓/✗ (P2)
- `(marketing)/features|changelog|docs` — description lengths + JSON-LD (P3)
- `app/dashboard/page.tsx` — add h1 (P3)

### BATCH 3 — Incomplete-tab / fake-radiogroup sweep (group=aria-pressed pattern)

Distinct files; parallelizable. Model on `trending-board.tsx` / `setup-form.tsx`:

- Community: `sentiment-gauge.tsx`, `s/[symbol]/symbol-stream.tsx`, `t/[tag]/tag-page.tsx`, `report-dialog.tsx` (radiogroup roving)
- Admin: `reports-section.tsx` (SegTabs), `submissions-section.tsx`, `feedback-section.tsx`
- Marketing: `mode-explorer.tsx`
- Backtesting: `strike-ladder.tsx` (listbox model), `setup-step.tsx` (Segmented group names)

### BATCH 4 — Form label-assoc + validation wiring (depends on 0e/0f)

Each feature dir is disjoint — parallelizable per file:

- `trades/components/trade-form.tsx` (largest), `journal/components/journal-editor.tsx`
- `onboarding/components/byod-wizard.tsx` + `setup-form.tsx` (P1)
- `account/components/*` (change-email/password, two-factor), `settings/components/*` (account, tags, appearance)
- `workflow/components/plan-trade-dialog.tsx` + `template-menu.tsx` + `template-manager-dialog.tsx`
- `playbooks/components/playbooks-panel.tsx`, `rules/components/rules-manager.tsx`, `goals/components/goals-section.tsx`
- `community/components/composer.tsx` (already mostly correct), `blog write` RichEditor label
- `features/blog/components/submit-form.tsx` (error role=alert + wiring)
- `csv-import.tsx` mapping selects, `trade-filters.tsx` checkbox naming

### BATCH 5 — Icon-only / unnamed control naming sweep

Distinct files; parallelizable:

- `layout/sidebar.tsx` + `topbar.tsx` (collapse toggle, settings trigger)
- `command-palette.tsx`, `unlock-screen.tsx` (label + error + invalid)
- `trade-detail.tsx` (delete attachment + hover-gating + ★), `tags-section.tsx` (add-tag Plus + hover-gating)
- `sessions-section.tsx` (unique Revoke/Sign-out names)
- `playbooks-panel.tsx` (Edit/Delete names), `rules-manager.tsx` (Switch/Edit/Delete names)
- `streak-indicator.tsx` (badge names + menu-in-menu)

### BATCH 6 — live-region announcements (async/dynamic)

Distinct files; parallelizable:

- Admin: all four section loaders + mod-queue refetch
- `monte-carlo.tsx`, `report-view.tsx`, `results-view.tsx`, `mode-switch-wizard.tsx`, `recompute-charges-section.tsx`
- Community: `feed.tsx`/`for-you-feed.tsx` errors, follow flows, DM typing/incoming, `new-posts-pill` (verified OK)
- `otp-input.tsx` completion/clear, `two-factor-section.tsx` fresh codes, `skeleton.tsx` consumers

### BATCH 7 — emoji-glyph → lucide sweep (lucide-only rule; A11Y-06)

Distinct files; parallelizable. Replace ✓✗×→∞⌘⋯≥≤★ −/+ \* `·`:

- `compare/tradezella-alternative`, `adherence-panel.tsx`, `streak-indicator.tsx`, `mode-switch-wizard.tsx`, `emotions-panel.tsx`/`mistakes-panel.tsx`
- `trade-detail.tsx`, `trade-filters.tsx`, `report-view.tsx`, `recent-trades.tsx`/`open-positions-card.tsx`
- Backtesting steps (setup/timing/risk/returns-tab/mobile-payoff/backtest-home/blotter/quick-view/walkforward)
- `topbar.tsx` (⌘K), `post-card.tsx` (⋯), `community-spotlight.tsx` (`·` bullets)

### BATCH 8 — Tables, landmarks, link-rel, video, misc P3

Distinct files; parallelizable:

- `admin-shell.tsx` + `page.tsx` (single `<main>` — P1)
- Tables: `ui/table.tsx` (scope/caption/scroll region), `day-time-heatmap.tsx`, `tax-report-view.tsx`, admin recent-signups
- Landmarks: `app-shell.tsx`/`sidebar.tsx` nav labels, community `<aside>` labels, `builder-shell.tsx` aside
- link-rel standardization: `bottom-nav.tsx`, `sidebar.tsx`, `site-header.tsx`, `reports-section.tsx`, `byod-wizard.tsx`
- `demo-video.tsx` captions track; `rich-editor.tsx` alt-text + in-app link dialog + sanitize
- `empty-state.tsx` heading level + Icon aria-hidden; `error-fallback.tsx` link; `date-time-picker.tsx` calendar grid

---

### Dependency notes for the orchestrator

- **BATCH 0 must merge before BATCH 3/4/6** (they rely on the new ring/heading/invalid/chart primitives to avoid re-touching the same lines).
- **BATCH 1a (community canonical) must merge before BATCH 2** community metadata routes.
- BATCH 0, 1, 7, 8 are **largely independent of each other** and can run concurrently from the start (file-disjoint).
- BATCH 2, 3, 4, 5, 6 are internally file-disjoint and parallelizable but should follow their primitive prerequisites.
