import * as React from "react";
import { Check, ChevronDown, ChevronUp, CircleAlert, ExternalLink, Zap } from "lucide-react";
import { parseContractName } from "@/features/trades/instrument-parse";
import { openAppTab } from "../lib/app-api";
import { buildQuickTradeValues, describeParsed } from "../lib/quick-trade";
import { useAccounts, usePlaybooks, useSaveTrade } from "../lib/journal";

interface SavedTrade {
  symbol: string;
  open: boolean;
}

/** The hero flow: log a trade in under ten seconds without leaving the broker tab. */
export function TradeForm({ appUrl }: { appUrl: string }) {
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
  const { data: playbooks = [] } = usePlaybooks();
  const saveTrade = useSaveTrade();

  const [instrument, setInstrument] = React.useState("");
  const [side, setSide] = React.useState<"buy" | "sell">("buy");
  const [qty, setQty] = React.useState("");
  const [entry, setEntry] = React.useState("");
  const [exit, setExit] = React.useState("");
  const [accountId, setAccountId] = React.useState("");
  const [playbookId, setPlaybookId] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [showMore, setShowMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<SavedTrade | null>(null);
  const instrumentRef = React.useRef<HTMLInputElement>(null);

  const effectiveAccountId = accountId || accounts[0]?.id || "";
  const parsed = React.useMemo(
    () => (instrument.trim() ? parseContractName(instrument) : null),
    [instrument]
  );

  const reset = () => {
    setInstrument("");
    setQty("");
    setEntry("");
    setExit("");
    setNotes("");
    setError(null);
    setSaved(null);
    requestAnimationFrame(() => instrumentRef.current?.focus());
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (saveTrade.isPending) return;
    setError(null);
    const result = buildQuickTradeValues({
      accountId: effectiveAccountId,
      instrument,
      side,
      qty,
      entry,
      exit,
      playbookId: playbookId || undefined,
      notes: notes || undefined,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    saveTrade.mutate(result.values, {
      onSuccess: () =>
        setSaved({
          symbol: result.values.symbol.toUpperCase(),
          open: result.values.avgExit == null,
        }),
      onError: (err) => setError(err instanceof Error ? err.message : "Could not save the trade"),
    });
  };

  if (accountsLoading) return null;

  if (accounts.length === 0) {
    return (
      <section className="card">
        <h2 className="card-title">Quick log</h2>
        <p className="note">
          Finish setting up your trading account in the web app first.{" "}
          <button type="button" className="link" onClick={() => openAppTab(appUrl)}>
            Open TradeMark
          </button>
        </p>
      </section>
    );
  }

  if (saved) {
    return (
      <section className="card">
        <div className="saved" role="status">
          <div className="saved-icon">
            <Check size={20} />
          </div>
          <div className="title">{saved.symbol} logged</div>
          <div className="sub">
            {saved.open ? "Saved as an open trade" : "Saved to your journal"}
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
              Log another
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <h2 className="card-title">
        Quick log
        <span className="meta">Enter saves</span>
      </h2>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="tm-instrument">Instrument</label>
          <input
            id="tm-instrument"
            ref={instrumentRef}
            value={instrument}
            onChange={(e) => setInstrument(e.target.value)}
            placeholder="BANKNIFTY24JUN52000CE or RELIANCE"
            autoComplete="off"
            autoFocus
            spellCheck={false}
          />
          {parsed && (
            <span className="parse-chip" data-testid="parse-chip">
              <Check size={12} />
              {describeParsed(parsed)}
            </span>
          )}
        </div>

        <div className="field">
          <label>Side</label>
          <div className="side-toggle" role="group" aria-label="Trade side">
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

        <div className="grid-3">
          <div className="field">
            <label htmlFor="tm-qty">Qty</label>
            <input
              id="tm-qty"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputMode="numeric"
              placeholder="30"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="tm-entry">Entry</label>
            <input
              id="tm-entry"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              inputMode="decimal"
              placeholder="120.50"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="tm-exit">Exit</label>
            <input
              id="tm-exit"
              value={exit}
              onChange={(e) => setExit(e.target.value)}
              inputMode="decimal"
              placeholder="open"
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
                <label htmlFor="tm-account">Account</label>
                <select
                  id="tm-account"
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
                <label htmlFor="tm-playbook">Setup / playbook</label>
                <select
                  id="tm-playbook"
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
              <label htmlFor="tm-notes">Notes</label>
              <textarea
                id="tm-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Why this trade?"
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
          <Zap size={15} />
          {saveTrade.isPending ? "Saving…" : "Save trade"}
        </button>
      </form>
    </section>
  );
}
