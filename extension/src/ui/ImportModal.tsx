import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, CircleAlert, Download, ExternalLink, X } from "lucide-react";
import { describeInstrument } from "@/features/trades/types";
import { openAppTab } from "../lib/app-api";
import { chargeProfileFor, useAccounts, useDb } from "../lib/journal";
import {
  buildImportPreview,
  importTrades,
  type ImportPreview,
  type ImportTrade,
} from "../lib/positions-import";
import { NoBrokerTabError, scrapeKiteTradebook } from "../lib/positions-capture";

type Phase =
  | { kind: "scanning" }
  | { kind: "error"; message: string; canRetry: boolean }
  | { kind: "empty" }
  | { kind: "preview"; preview: ImportPreview }
  | { kind: "importing" }
  | { kind: "done"; imported: number; skipped: number };

const inr = (n: number) =>
  `${n < 0 ? "-" : ""}₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/**
 * Reads the user's authenticated Kite tradebook (via the opt-in content
 * script), previews the executed trades against what's already journaled, and
 * imports the chosen NEW ones through the shared statement builder.
 */
export function ImportModal({ appUrl, onClose }: { appUrl: string; onClose: () => void }) {
  const db = useDb();
  const qc = useQueryClient();
  const { data: accounts = [] } = useAccounts();
  const [phase, setPhase] = React.useState<Phase>({ kind: "scanning" });
  // Selection is keyed by dedupe id; NEW rows default checked, existing ones unchecked.
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const accountId = accounts[0]?.id ?? "";

  const scan = React.useCallback(async () => {
    setPhase({ kind: "scanning" });
    try {
      const fills = await scrapeKiteTradebook();
      if (fills.length === 0) {
        setPhase({ kind: "empty" });
        return;
      }
      if (!accountId) {
        setPhase({
          kind: "error",
          message: "Finish setting up your trading account in the web app first.",
          canRetry: false,
        });
        return;
      }
      const profileId = await chargeProfileFor(db, accountId);
      const preview = await buildImportPreview(fills, accountId, profileId, db);
      if (preview.trades.length === 0) {
        setPhase({ kind: "empty" });
        return;
      }
      setSelected(new Set(preview.trades.filter((t) => !t.existing).map((t) => t.id)));
      setPhase({ kind: "preview", preview });
    } catch (e) {
      setPhase({
        kind: "error",
        message: e instanceof Error ? e.message : "Could not read your broker page.",
        canRetry: !(e instanceof NoBrokerTabError),
      });
    }
  }, [accountId, db]);

  React.useEffect(() => {
    void scan();
  }, [scan]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const doImport = async (preview: ImportPreview) => {
    const chosen = preview.trades.filter((t) => selected.has(t.id));
    if (chosen.length === 0) return;
    setPhase({ kind: "importing" });
    try {
      const profileId = await chargeProfileFor(db, accountId);
      const imported = await importTrades(chosen, profileId, db);
      // Imported trades feed the glance strip + the rules-nudge toolbar badge.
      void qc.invalidateQueries({ queryKey: ["glance"] });
      void qc.invalidateQueries({ queryKey: ["badge"] });
      setPhase({ kind: "done", imported, skipped: preview.skippedNoTime });
    } catch (e) {
      setPhase({
        kind: "error",
        message: e instanceof Error ? e.message : "Import failed — try again.",
        canRetry: true,
      });
    }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="import-modal" role="dialog" aria-label="Import trades from Kite">
        <header className="import-head">
          <span className="brand-row">
            <Download size={15} />
            Import from Zerodha Kite
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close import">
            <X size={16} />
          </button>
        </header>

        {phase.kind === "scanning" && (
          <div className="import-state" role="status">
            <div className="spinner" />
            <p>Reading your Kite tradebook…</p>
          </div>
        )}

        {phase.kind === "empty" && (
          <div className="import-state">
            <p>No executed trades found on the open Kite page.</p>
            <p className="hint">
              Open Kite&rsquo;s Orders (Executed) or Positions page, then scan again.
            </p>
            <button type="button" className="btn-ghost" onClick={() => void scan()}>
              Scan again
            </button>
          </div>
        )}

        {phase.kind === "error" && (
          <div className="import-state" role="alert">
            <div className="import-state-icon">
              <CircleAlert size={20} />
            </div>
            <p>{phase.message}</p>
            {phase.canRetry && (
              <button type="button" className="btn-ghost" onClick={() => void scan()}>
                Try again
              </button>
            )}
          </div>
        )}

        {phase.kind === "preview" && (
          <PreviewBody
            preview={phase.preview}
            selected={selected}
            onToggle={toggle}
            onImport={() => void doImport(phase.preview)}
            onSelectAllNew={() =>
              setSelected(new Set(phase.preview.trades.filter((t) => !t.existing).map((t) => t.id)))
            }
            onClear={() => setSelected(new Set())}
          />
        )}

        {phase.kind === "importing" && (
          <div className="import-state" role="status">
            <div className="spinner" />
            <p>Importing {selected.size} trades…</p>
          </div>
        )}

        {phase.kind === "done" && (
          <div className="import-state" data-testid="import-done">
            <div className="import-state-icon ok">
              <Check size={20} />
            </div>
            <p className="import-done-title">
              {phase.imported} {phase.imported === 1 ? "trade" : "trades"} imported
            </p>
            {phase.skipped > 0 && (
              <p className="hint">{phase.skipped} fills skipped (no readable time).</p>
            )}
            <div className="import-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => openAppTab(appUrl, "/app/trades")}
              >
                <ExternalLink size={13} />
                View in journal
              </button>
              <button type="button" className="btn-primary import-done-close" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function PreviewBody({
  preview,
  selected,
  onToggle,
  onImport,
  onSelectAllNew,
  onClear,
}: {
  preview: ImportPreview;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onImport: () => void;
  onSelectAllNew: () => void;
  onClear: () => void;
}) {
  const newCount = preview.trades.filter((t) => !t.existing).length;
  const existingCount = preview.trades.length - newCount;
  const chosenCount = preview.trades.filter((t) => selected.has(t.id)).length;

  return (
    <>
      <div className="import-summary">
        <span>
          <strong>{newCount}</strong> new · {existingCount} already in journal
        </span>
        <span className="import-select-actions">
          <button type="button" className="link" onClick={onSelectAllNew}>
            All new
          </button>
          <button type="button" className="link" onClick={onClear}>
            None
          </button>
        </span>
      </div>

      <div className="import-rows" role="table" aria-label="Trades to import">
        {preview.trades.map((item) => (
          <PreviewRow
            key={item.id}
            item={item}
            checked={selected.has(item.id)}
            onToggle={() => onToggle(item.id)}
          />
        ))}
      </div>

      <button
        type="button"
        className="btn-primary import-cta"
        onClick={onImport}
        disabled={chosenCount === 0}
        data-testid="import-trades"
      >
        <Download size={15} />
        {chosenCount === 0 ? "Select trades to import" : `Import ${chosenCount} trades`}
      </button>
    </>
  );
}

function PreviewRow({
  item,
  checked,
  onToggle,
}: {
  item: ImportTrade;
  checked: boolean;
  onToggle: () => void;
}) {
  const t = item.trade;
  const when = new Date(t.opened_at).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
  return (
    <label className={`import-row${item.existing ? " is-existing" : ""}`} role="row">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={`Import ${describeInstrument(t)}`}
      />
      <span className="import-row-main">
        <span className="import-row-inst">
          {describeInstrument(t)}
          {item.existing && <span className="import-tag">in journal</span>}
        </span>
        <span className="import-row-meta">
          {when} · {t.direction === "long" ? "Long" : "Short"} · {t.qty} qty
        </span>
      </span>
      <span className="import-row-pnl">
        {t.status === "closed" ? (
          <span className={t.net_pnl >= 0 ? "profit" : "loss"}>{inr(t.net_pnl)}</span>
        ) : (
          <span className="warning">open</span>
        )}
      </span>
    </label>
  );
}
