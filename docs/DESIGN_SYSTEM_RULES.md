# Design-System Rules (Figma ↔ Code)

> Generated from the codebase as the equivalent of Figma's `create_design_system_rules`.
> Read this before generating code from a Figma design, or before building/pushing
> a screen into Figma — so output uses the real tokens, primitives, and conventions
> instead of hardcoded hex/px. **Never hardcode a colour or spacing value that has a
> token below.**

## 1. Stack

- **Framework:** Next.js (App Router, RSC), TypeScript, React 19.
- **Styling:** **Tailwind CSS v4 — CSS-first.** There is **no `tailwind.config.*`**; the theme is declared with `@theme inline` in `src/styles/globals.css`. Add tokens there, not in a JS config.
- **Primitives:** shadcn/ui on Radix, in `src/components/ui/*`. Class merging via `cn()` from `@/lib/utils` (clsx + tailwind-merge).
- **Fonts:** Geist Sans (`--font-sans`) + Geist Mono (`--font-mono`), loaded in the root layout.
- **Icons:** `lucide-react`.
- **Code Connect:** none yet (no `*.figma.tsx`). When wiring Figma, map components to `src/components/ui/*` per §6.

## 2. Color tokens — the single source of truth

Semantic CSS variables live on `:root`/`.light` and each dark theme in `globals.css`, and are exposed to Tailwind as `--color-*` utilities via `@theme inline`. **Always use the semantic Tailwind class, never a hex.**

| Token (CSS var)  | Tailwind class                | Light value | Role                                                                        |
| ---------------- | ----------------------------- | ----------- | --------------------------------------------------------------------------- |
| `--bg`           | `bg-bg`                       | `#fafafa`   | App canvas                                                                  |
| `--surface`      | `bg-surface`                  | `#ffffff`   | Cards / panels                                                              |
| `--surface-2`    | `bg-surface-2`                | `#f4f4f5`   | Secondary surface (table headers, chips, tiles)                             |
| `--border`       | `border-border`               | `#e4e4e7`   | Hairline borders (also the global `*` border-color)                         |
| `--text`         | `text-foreground`             | `#18181b`   | Primary text                                                                |
| `--text-muted`   | `text-muted`                  | `#71717a`   | Secondary text, labels, hints                                               |
| `--profit`       | `text-profit` / `bg-profit`   | `#059669`   | Gains, bullish, wins                                                        |
| `--loss`         | `text-loss` / `bg-loss`       | `#dc2626`   | Losses, bearish                                                             |
| `--accent`       | `text-accent` / `bg-accent`   | `#7c3aed`   | Brand / interactive (violet)                                                |
| `--accent-solid` | `bg-accent-solid`             | `#7c3aed`   | **Solid fills** (deeper shade so white text stays ≥ WCAG AA on dark themes) |
| `--accent-fg`    | `text-accent-fg`              | `#ffffff`   | Text/icon on an accent fill                                                 |
| `--warning`      | `text-warning` / `bg-warning` | `#d97706`   | Caution, open positions, low coverage                                       |

Rules:

- **Opacity via `/`:** tint with `bg-accent/10`, `border-accent/30`, `text-loss/80`, etc. — don't invent new hexes for tints.
- **Profit/Loss is semantic, not decorative.** Green/red only ever means up/down money. Use `<PnlText value={n}/>` (`src/components/shared/pnl-text.tsx`) for signed P&L so colour + sign + format are consistent.
- **`bg-accent` vs `bg-accent-solid`:** use `accent-solid` for filled buttons/badges (contrast); `accent` (often at low opacity) for tints, rings, highlights.

## 3. Theming

- **4 themes:** `light` (default, on `:root`), and dark `carbon` / `midnight` / `oled` — set as a **class on `<html>`** by `next-themes`. The `dark:` variant is custom: `@custom-variant dark (&:where(.carbon, .midnight, .oled, …))`.
- Every dark theme **redefines the same semantic vars** — so building with tokens themes for free. Never branch on theme in components; rely on the vars.
- **Colour-blind P&L:** `[data-pl="cb"]` swaps profit/loss to blue/orange. Because P&L uses `--profit`/`--loss`, this works automatically — another reason never to hardcode green/red.
- **Print:** `@media print` forces white/black + hides chrome (`aside`, topbar, primary `nav`). Mark printable regions with `data-print-section` / page breaks with `data-print-break`.

## 4. Typography

- **Body:** Geist Sans, `font-variant-numeric: tabular-nums` globally (numbers align).
- **`.font-money`** — the money/number treatment: Geist Mono + tabular-nums + `-0.01em` tracking. Use on **every monetary or key numeric value** (P&L, prices, lots, counts). e.g. `<span className="font-money font-semibold tabular-nums">`.
- **`.micro-label`** — section/column labels: `0.6875rem`, weight 600, `0.08em` tracking, uppercase, `--text-muted`. Use for stat-tile labels, table headers, eyebrows.
- Type scale = Tailwind defaults (`text-xs … text-2xl`); headings are `font-semibold`/`font-bold`, not a separate display face.

## 5. Spacing, radius, breakpoints, motion

- **Spacing/sizing:** Tailwind default scale (`gap-2`, `p-3`, `h-9/10/11`, etc.). Touch targets ≥ 44px (`h-11` / `min-h-11`) for primary mobile actions.
- **Radius:** Tailwind defaults; `rounded-lg` = **10px** (`--radius-lg`). Cards/inputs use `rounded-lg`/`rounded-md`.
- **Breakpoints:** Tailwind `sm=640 md=768 lg=1024 xl=1280` **plus a custom `xs=480px`** (`--breakpoint-xs`) for tight 360–480px phone rows. Design responsive: stack dense grids on mobile (`grid-cols-1 sm:grid-cols-3`).
- **Motion:** named animations in `@theme` (`animate-fade-in`, `animate-slide-up`, `animate-grow-x/y`, `animate-rise`, `animate-float-slow`). All respect `prefers-reduced-motion` (globally zeroed). Don't add bespoke keyframes when one of these fits.
- **Honesty marker:** `.bt-hatch` = diagonal hatch over a surface for "no data" cells (never let an empty cell read as a real ₹0).

## 6. Component primitives (`src/components/ui/`)

Prefer these over hand-built boxes. When importing a Figma design, map its components to these:

`button` · `input` · `textarea` · `label` · `card` (Card/CardHeader/CardContent/CardFooter/CardTitle) · `badge` (variants: default·secondary·profit·loss·warning·outline) · `select` · `dropdown-menu` · `tabs` (Tabs/TabsList/TabsTrigger/TabsContent) · `dialog` (`p-5`, `max-h-[88vh]` scroll) · `sheet` (vaul bottom sheet, mobile; `p-5`) · `popover` · `tooltip` · `table` · `switch` · `checkbox` · `slider` · `progress` · `separator` · `skeleton` · `confirm-dialog` · `date-time-picker` · `segmented-control` (pill group; `tone` accent/profit/loss) · `rich-editor` / `rich-content`.

Shared, non-`ui/` building blocks: `@/components/shared/pnl-text` (signed coloured P&L), `donut`, `page-header`.

Conventions:

- Modals: desktop = `Dialog` (`sm:max-w-2xl` etc.), mobile = `Sheet`; the **same form renders in both**. Both use `p-5` so a sticky footer can bleed with `-mx-5 -mb-5`.
- Forms: React Hook Form + Zod (`@hookform/resolvers/zod`); segment/direction/option-type choices use `SegmentedControl`, not raw radios.

## 7. Figma variable + style naming (when pushing to / pulling from Figma)

To keep Figma and code 1:1, name Figma **variables** to mirror the tokens so they round-trip:

- Colors collection: `bg`, `surface`, `surface-2`, `border`, `text`, `text-muted`, `profit`, `loss`, `accent`, `accent-solid`, `accent-fg`, `warning` — with modes **Light / Carbon / Midnight / OLED** matching §2–§3 values.
- Text styles: `money` (Geist Mono, tabular, -1% tracking), `micro-label` (11px/600/upper/0.08em), plus body sizes mapped to `text-xs…2xl`.
- Radius: `lg = 10`. Spacing: Tailwind 4px scale.

When **generating code from Figma**: translate fills → the matching `bg-*`/`text-*`/`border-*` class (or `/opacity` tint), Geist Mono numerics → `.font-money`, uppercase tracked labels → `.micro-label`, and reach for a `src/components/ui/*` primitive before drawing a div. When **pushing code to Figma**: bind component fills/spacing to the variables above, don't paste hexes.

## 8. Notes specific to this repo

- The **backtesting area has its own "terminal" aesthetic** (phosphor-amber, `src/styles/bt-terminal.css` with `--bt-*` tokens + `.bt-panel/.bt-num/.bt-label` classes). That layer is **on the `feature/backtesting-expansion` branch, not yet on `main`** — treat it as a scoped sub-identity for `/backtesting/**` only; the rest of the app uses the §2 journal tokens. A redesign of the backtesting universe is in flight (branch off `main`).
- Place this file's guidance ahead of any ad-hoc styling. If a value isn't covered by a token, add the token to `globals.css` `@theme` rather than hardcoding it.
