import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * BtSection — the dossier numbered-section wrapper (TAPE). Turns the backtesting
 * universe into one paginated instrument-report: each primary section opens with
 * a numbered `.micro-label` eyebrow ("01 ·") against a 2px `--bt-rule` left-gutter
 * spine. The spine is sm+ only; below sm it collapses to a top-border eyebrow.
 *
 * Reuses the existing `.micro-label` token verbatim; the mono "01 ·" numeral
 * prefix is the only graft. Used by Results' three tiers (01·VERDICT /
 * 02·EVIDENCE / 03·TRADE-BY-TRADE) and the landing's sample/featured rhythm.
 */
export function BtSection({
  number,
  eyebrow,
  spine = true,
  action,
  children,
  className,
  "data-testid": testid,
}: {
  /** The dossier number, e.g. "01". Omit for an eyebrow-only section. */
  number?: string;
  eyebrow: string;
  /** Render the 2px left-gutter spine (sm+). Off for marketing rows. */
  spine?: boolean;
  /** Optional right-aligned action (e.g. a "Tweak this" ghost link). */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <section
      className={cn(
        "bt-section border-t pt-3 sm:border-t-0 sm:pt-0",
        spine && "sm:bt-section-spine",
        className
      )}
      data-testid={testid}
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="micro-label flex items-baseline gap-1.5">
          {number && <span className="bt-section-num">{number} ·</span>}
          <span>{eyebrow}</span>
        </p>
        {action}
      </div>
      {children}
    </section>
  );
}
