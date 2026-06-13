# Goal 2 — Inline "Assign setups" (make the unassigned-trades nudge actionable)

> **Status:** Build-ready spec. **This is GOAL 2 — a separate, journal-side initiative**, documented
> here alongside the backtesting plan (Goal 1) at the founder's request. It does **not** depend on
> the backtester and can ship independently. Audience: the implementation workflow.

---

## The problem

The Playbooks page shows a **passive** nudge and then strands the user:

- `src/features/playbooks/components/playbooks-panel.tsx:74` →
  `const unassigned = closed.filter((t) => !t.playbook_id).length;`
- `:80-83` renders _"⚠ {unassigned} closed trades have no setup assigned."_ — as plain text.

To actually fix it, the user must leave for the Trades table, enter a hidden "Select" mode, and
bulk-assign — or edit trades one by one. The nudge creates guilt but offers no path. **We close that
loop in place.**

## The insight: the hard part already exists

- **Transactional bulk assign** is already built and storage-mode-agnostic:
  `buildBulkStatements({ kind: "setPlaybook", playbookId }, tradeIds)`
  (`src/features/workflow/bulk-actions.ts:101`) compiles to one `db.batch(...)` that fully applies
  or fully rolls back — identical across hosted / BYOD / local (sql.js).
- The **trades table already supports row selection** via a `selection` prop (header + per-row
  checkboxes): `src/features/trades/components/trades-table.tsx:24,76,122`.
- Selection is currently **gated behind a "Select" toggle**:
  `src/app/app/trades/page.tsx:63` `const [selectMode, setSelectMode] = useState(false)`, button at
  `:106-110`, and `BulkActionBar` only renders when `selectMode` is on (`:167`).

So the feature is mostly **deleting a gate + adding one filter + one link** — not building new UI.

## The decision (per founder): selection on by default, no separate button

Rather than a bespoke "assign" dialog, **reuse the existing selectable rows + bulk-assign, always
available**:

1. **Make row selection always-on.** Remove the `selectMode` gate and the "Select"/"Done" button —
   the checkbox column + `BulkActionBar` are simply always present (Gmail/Notion-style). One-click
   bulk actions everywhere, no mode switch.
2. **Turn the Playbooks nudge into a deep-link**, not a separate UI:
   _"⚠ {n} closed trades have no setup → **Review**"_ navigates to the Trades table **pre-filtered to
   "No setup"** (`playbook_id IS NULL`, closed). The user ticks rows → existing `BulkActionBar` →
   **Set playbook** → assigned in one transaction. The count ticks down as they go.
3. Add a **"No setup" filter chip** so the view is reachable anytime from the Trades filters.

## UX detail

```
Playbooks page
┌───────────────────────────────────────────────┐
│ ⚠ 14 closed trades have no setup →  [ Review ] │   ← was plain text; now a button/link
└───────────────────────────────────────────────┘
        │ navigates to
        ▼
Trades  ?filter=no-setup        (selection ALWAYS on)
┌──┬──────────┬────────┬─────┬───────────────────┐
│☐ │ Date     │ Symbol │ Dir │ Net P&L           │
│☑ │ 12 Jun   │ NIFTY  │ ▲   │ +2,400            │
│☑ │ 11 Jun   │ BANKN. │ ▼   │ −1,150            │
└──┴──────────┴────────┴─────┴───────────────────┘
  ┌─ BulkActionBar (2 selected) ───────────────────┐
  │  Tag ▾   |  Set playbook ▾  |  Delete           │
  └────────────────────────────────────────────────┘
```

- **Mobile:** the checkbox collapses into a tap target inside the row so the table doesn't get a
  permanent extra column on small screens (the one trade-off of always-on selection).
- **Empty/success state:** when `unassigned === 0`, the nudge is replaced by a calm
  _"Every closed trade has a setup ✓"_ — never shown as a warning.

## Phasing

- **Phase 1 (MVP):** always-on selection + "No setup" filter + nudge → deep-link. Reuses
  `buildBulkStatements`, `BulkActionBar`, `usePlaybooks`, `useTrades`, the virtualized table. Net-new
  is mostly _deletion_ of the toggle + one filter predicate + one link. Acceptance: from the
  Playbooks nudge, a user can assign N trades to a playbook in ≤3 taps without leaving the flow; the
  Playbooks count updates live.
- **Phase 2 (smart):** per-trade suggested playbook (match by symbol / time-of-day / criteria
  keywords) with one-tap accept; inline "Create new playbook" when none fits.

## Files touched (implementation map)

- `src/app/app/trades/page.tsx` — remove `selectMode` gating; selection always passed; `BulkActionBar`
  shows whenever `selected.size > 0`. Read a `?filter=no-setup` (or filter-store flag) to pre-apply
  the unassigned filter.
- `src/features/trades/filter-predicate.ts` (+ `trade-filters.tsx`) — add a **"No setup"**
  (`playbook_id == null`, closed) filter chip.
- `src/features/playbooks/components/playbooks-panel.tsx` — nudge becomes a `Link`/`Button` to the
  filtered trades view; add the all-assigned success state.
- No schema change. No new dialog. Reuses the existing bulk-assign transaction.

## Risk / note

Always-on selection slightly increases table density (a persistent checkbox affordance). Mitigated on
mobile by collapsing it into the row. This is a deliberate, founder-approved trade for frictionless
bulk actions across the journal — not just for this nudge.
