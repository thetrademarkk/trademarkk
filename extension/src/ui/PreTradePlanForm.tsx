import * as React from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  ClipboardList,
  ExternalLink,
  Target,
} from "lucide-react";
import { parseContractName } from "@/features/trades/instrument-parse";
import { productsForSegment, SEGMENTS } from "@/features/trades/schemas";
import type { Product, Segment } from "@/features/trades/types";
import { openAppTab } from "../lib/app-api";
import { buildPreTradePlanValues } from "../lib/pre-trade-plan";
import { describeParsed } from "../lib/quick-trade";
import { useAccounts, usePlaybooks, useSaveTrade } from "../lib/journal";

const SEGMENT_LABELS: Record<Segment, string> = {
  EQ: "Equity",
  FUT: "Futures",
  OPT: "Options",
  COMM: "Commodity",
  CDS: "Currency",
};

/**
 * Plan a trade BEFORE you enter it: capture the instrument, segment/product,
 * direction, size and the risk plan (entry / stop / target). The plan is saved
 * as an OPEN trade carrying planned_*; the user fills the actual entry/exit on
 * the web to "execute" it, and the journal's discipline-v2 plan-adherence
 * metric grades the result automatically.
 */
export function PreTradePlanForm({ appUrl }: { appUrl: string }) {
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
  const { data: playbooks = [] } = usePlaybooks();
  const saveTrade = useSaveTrade();

  const [instrument, setInstrument] = React.useState("");
  const [segment, setSegment] = React.useState<Segment>("EQ");
  const [product, setProduct] = React.useState<Product>("MIS");
  const [side, setSide] = React.useState<"buy" | "sell">("buy");
  const [qty, setQty] = React.useState("");
  const [plannedEntry, setPlannedEntry] = React.useState("");
  const [plannedSl, setPlannedSl] = React.useState("");
  const [plannedTarget, setPlannedTarget] = React.useState("");
  const [accountId, setAccountId] = React.useState("");
  const [playbookId, setPlaybookId] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [showMore, setShowMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);
  const instrumentRef = React.useRef<HTMLInputElement>(null);

  const effectiveAccountId = accountId || accounts[0]?.id || "";
  const parsed = React.useMemo(
    () => (instrument.trim() ? parseContractName(instrument) : null),
    [instrument]
  );

  // The contract parser owns segment for recognised option/future names — keep
  // the selector in step so the product list and the saved row never disagree.
  React.useEffect(() => {
    if (parsed && (parsed.segment === "OPT" || parsed.segment === "FUT")) {
      setSegment(parsed.segment);
    }
  }, [parsed]);

  const products = productsForSegment(segment);
  // Keep the product valid whenever the segment changes.
  React.useEffect(() => {
    if (!products.includes(product)) setProduct(products[0]!);
  }, [products, product]);

  const reset = () => {
    setInstrument("");
    setQty("");
    setPlannedEntry("");
    setPlannedSl("");
    setPlannedTarget("");
    setNotes("");
    setError(null);
    setSaved(null);
    requestAnimationFrame(() => instrumentRef.current?.focus());
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (saveTrade.isPending) return;
    setError(null);
    const result = buildPreTradePlanValues({
      accountId: effectiveAccountId,
      instrument,
      segment,
      product,
      side,
      qty,
      plannedEntry,
      plannedSl,
      plannedTarget,
      playbookId: playbookId || undefined,
      notes: notes || undefined,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    saveTrade.mutate(result.values, {
      onSuccess: () => setSaved(result.values.symbol.toUpperCase()),
      onError: (err) => setError(err instanceof Error ? err.message : "Could not save the plan"),
    });
  };

  if (accountsLoading) return null;

  if (accounts.length === 0) {
    return (
      <section className="card">
        <h2 className="card-title">Plan a trade</h2>
        <p className="note">
          Finish setting up your trading account in the web app first.{" "}
          <button type="button" className="link" onClick={() => openAppTab(appUrl)}>
            Open TradeMarkk
          </button>
        </p>
      </section>
    );
  }

  if (saved) {
    return (
      <section className="card">
        <div className="saved" role="status">
          <div className="saved-icon plan">
            <Target size={20} />
          </div>
          <div className="title">{saved} planned</div>
          <div className="sub">
            Saved as an open trade. Fill the actual entry &amp; exit to execute it.
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => openAppTab(appUrl, "/app/trades")}
            >
              <ExternalLink size={13} />
              View in journal
            </button>
            <button
              type="button"
              className="btn-primary"
              style={{ width: "auto", padding: "7px 12px" }}
              onClick={reset}
            >
              Plan another
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <h2 className="card-title">
        Plan a trade
        <span className="meta">Before you enter</span>
      </h2>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="tm-plan-instrument">Instrument</label>
          <input
            id="tm-plan-instrument"
            ref={instrumentRef}
            value={instrument}
            onChange={(e) => setInstrument(e.target.value)}
            placeholder="BANKNIFTY24JUN52000CE or RELIANCE"
            autoComplete="off"
            spellCheck={false}
          />
          {parsed && (
            <span className="parse-chip" data-testid="plan-parse-chip">
              <Check size={12} />
              {describeParsed(parsed)}
            </span>
          )}
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="tm-plan-segment">Segment</label>
            <select
              id="tm-plan-segment"
              value={segment}
              onChange={(e) => setSegment(e.target.value as Segment)}
            >
              {SEGMENTS.map((s) => (
                <option key={s} value={s}>
                  {SEGMENT_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tm-plan-product">Product</label>
            <select
              id="tm-plan-product"
              value={product}
              onChange={(e) => setProduct(e.target.value as Product)}
            >
              {products.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label>Side</label>
          <div className="side-toggle" role="group" aria-label="Plan side">
            <button
              type="button"
              className={side === "buy" ? "active-buy" : ""}
              aria-pressed={side === "buy"}
              onClick={() => setSide("buy")}
            >
              Buy
            </button>
            <button
              type="button"
              className={side === "sell" ? "active-sell" : ""}
              aria-pressed={side === "sell"}
              onClick={() => setSide("sell")}
            >
              Sell
            </button>
          </div>
        </div>

        <div className="field">
          <label htmlFor="tm-plan-qty">Qty</label>
          <input
            id="tm-plan-qty"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            inputMode="numeric"
            placeholder="30"
            autoComplete="off"
          />
        </div>

        <div className="grid-3">
          <div className="field">
            <label htmlFor="tm-plan-entry">Planned entry</label>
            <input
              id="tm-plan-entry"
              value={plannedEntry}
              onChange={(e) => setPlannedEntry(e.target.value)}
              inputMode="decimal"
              placeholder="120.50"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="tm-plan-sl">Stop loss</label>
            <input
              id="tm-plan-sl"
              value={plannedSl}
              onChange={(e) => setPlannedSl(e.target.value)}
              inputMode="decimal"
              placeholder="90.00"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="tm-plan-target">Target</label>
            <input
              id="tm-plan-target"
              value={plannedTarget}
              onChange={(e) => setPlannedTarget(e.target.value)}
              inputMode="decimal"
              placeholder="180.00"
              autoComplete="off"
            />
          </div>
        </div>

        <button
          type="button"
          className="disclosure"
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
        >
          {showMore ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          Setup &amp; notes
        </button>

        {showMore && (
          <>
            {accounts.length > 1 && (
              <div className="field">
                <label htmlFor="tm-plan-account">Account</label>
                <select
                  id="tm-plan-account"
                  value={effectiveAccountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {playbooks.length > 0 && (
              <div className="field">
                <label htmlFor="tm-plan-playbook">Setup / playbook</label>
                <select
                  id="tm-plan-playbook"
                  value={playbookId}
                  onChange={(e) => setPlaybookId(e.target.value)}
                >
                  <option value="">None</option>
                  {playbooks.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label htmlFor="tm-plan-notes">Notes</label>
              <textarea
                id="tm-plan-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Why this trade? What invalidates it?"
              />
            </div>
          </>
        )}

        {error && (
          <div className="form-error" role="alert">
            <CircleAlert size={14} />
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary" disabled={saveTrade.isPending}>
          <ClipboardList size={15} />
          {saveTrade.isPending ? "Saving…" : "Save plan"}
        </button>
      </form>
    </section>
  );
}
