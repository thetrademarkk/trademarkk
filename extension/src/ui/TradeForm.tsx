import * as React from "react";
import {
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  ExternalLink,
  Import,
  Loader2,
  X,
  Zap,
} from "lucide-react";
import { parseContractName } from "@/features/trades/instrument-parse";
import { brokerLabel } from "../brokers";
import { openAppTab } from "../lib/app-api";
import { onPendingCapture, takePendingCapture, type PendingCapture } from "../lib/capture";
import { buildQuickTradeValues, describeParsed } from "../lib/quick-trade";
import { useAccounts, useAddAttachment, usePlaybooks, useSaveTrade } from "../lib/journal";
import { captureVisibleTab, compressScreenshot } from "../lib/screenshot";

interface SavedTrade {
  symbol: string;
  open: boolean;
  withScreenshot: boolean;
}

/** The hero flow: log a trade in under ten seconds without leaving the broker tab. */
export function TradeForm({ appUrl }: { appUrl: string }) {
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
  const { data: playbooks = [] } = usePlaybooks();
  const saveTrade = useSaveTrade();
  const addAttachment = useAddAttachment();

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
  const [capturedFrom, setCapturedFrom] = React.useState<PendingCapture | null>(null);
  // A captured + compressed chart screenshot, attached to the trade on save.
  const [screenshot, setScreenshot] = React.useState<string | null>(null);
  const [capturing, setCapturing] = React.useState(false);
  const instrumentRef = React.useRef<HTMLInputElement>(null);

  // Broker-page capture (purely additive sugar): a "Log in TradeMarkk" click on
  // the broker's order window staged a CapturedOrder — prefill the quick log.
  // Everything stays editable; manual logging is unchanged when nothing lands.
  React.useEffect(() => {
    let active = true;
    const apply = (c: PendingCapture) => {
      if (!active) return;
      setSaved(null);
      setError(null);
      setInstrument(c.symbol);
      setSide(c.side);
      setQty(c.qty != null ? String(c.qty) : "");
      setEntry(c.price != null ? String(c.price) : "");
      setExit("");
      setCapturedFrom(c);
    };
    void takePendingCapture().then((c) => c && apply(c));
    const off = onPendingCapture(apply);
    return () => {
      active = false;
      off();
    };
  }, []);

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
    setCapturedFrom(null);
    setScreenshot(null);
    requestAnimationFrame(() => instrumentRef.current?.focus());
  };

  // Capture the visible broker/chart tab on an explicit click, downscale +
  // compress it to a small JPEG, and stage it as a removable preview. Privacy:
  // nothing is read until this click, and only the visible tab is captured.
  const onCapture = async () => {
    if (capturing) return;
    setError(null);
    setCapturing(true);
    try {
      const raw = await captureVisibleTab();
      setScreenshot(await compressScreenshot(raw));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not capture the chart.");
    } finally {
      setCapturing(false);
    }
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
      onSuccess: async (tradeId) => {
        // Persist the captured chart as a trade-linked AttachmentRow — the same
        // write path as the web app, so it renders on the web trade-detail.
        let attached = false;
        if (screenshot) {
          try {
            await addAttachment.mutateAsync({ tradeId, data: screenshot });
            attached = true;
          } catch {
            // The trade is already saved; a failed screenshot must not block the
            // success state. The user can still add it from the web trade-detail.
          }
        }
        setSaved({
          symbol: result.values.symbol.toUpperCase(),
          open: result.values.avgExit == null,
          withScreenshot: attached,
        });
      },
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
          <div className="saved-icon">
            <Check size={20} />
          </div>
          <div className="title">{saved.symbol} logged</div>
          <div className="sub">
            {saved.open ? "Saved as an open trade" : "Saved to your journal"}
            {saved.withScreenshot ? " · chart attached" : ""}
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
      {capturedFrom && (
        <div className="capture-chip" data-testid="capture-chip" role="status">
          <Import size={12} />
          From {brokerLabel(capturedFrom.broker)}
          <button
            type="button"
            aria-label="Dismiss broker capture"
            onClick={() => setCapturedFrom(null)}
          >
            <X size={11} />
          </button>
        </div>
      )}
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

        <div className="field">
          <label>Chart</label>
          {screenshot ? (
            <div className="shot-preview" data-testid="screenshot-preview">
              {/* eslint-disable-next-line @next/next/no-img-element -- extension panel, not Next */}
              <img src={screenshot} alt="Captured chart screenshot" />
              <button
                type="button"
                className="shot-remove"
                aria-label="Remove captured chart"
                onClick={() => setScreenshot(null)}
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn-ghost shot-capture"
              onClick={() => void onCapture()}
              disabled={capturing}
              data-testid="capture-chart"
            >
              {capturing ? <Loader2 size={14} className="spin" /> : <Camera size={14} />}
              {capturing ? "Capturing…" : "Capture chart"}
            </button>
          )}
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
