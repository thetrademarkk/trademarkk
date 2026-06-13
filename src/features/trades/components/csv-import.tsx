"use client";

import * as React from "react";
import { FileCheck, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PnlText } from "@/components/shared/pnl-text";
import { useAccounts, useImportTrades } from "../queries";
import { detectMapping, pairFillsToTrades, rowsToFills, type ColumnMapping } from "../csv";
import { detectBroker, type BrokerSpec } from "../csv-brokers";
import type { TradeRow } from "../types";

const FIELDS: { key: keyof ColumnMapping; label: string; required: boolean }[] = [
  { key: "symbol", label: "Symbol", required: true },
  { key: "side", label: "Buy/Sell", required: true },
  { key: "qty", label: "Quantity", required: true },
  { key: "price", label: "Price", required: true },
  { key: "time", label: "Date/Time", required: true },
  { key: "expiry", label: "Expiry (optional)", required: false },
];

export function CsvImport() {
  const [open, setOpen] = React.useState(false);
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<Record<string, string>[]>([]);
  const [broker, setBroker] = React.useState<BrokerSpec | null>(null);
  const [mapping, setMapping] = React.useState<Partial<ColumnMapping>>({});
  const [preview, setPreview] = React.useState<TradeRow[] | null>(null);
  const { data: accounts = [] } = useAccounts();
  const importTrades = useImportTrades();

  const reset = () => {
    setHeaders([]);
    setRows([]);
    setBroker(null);
    setMapping({});
    setPreview(null);
  };

  const onFile = async (file: File) => {
    const Papa = (await import("papaparse")).default;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const hdrs = res.meta.fields ?? [];
        const detected = detectBroker(hdrs);
        setHeaders(hdrs);
        setRows(res.data);
        setBroker(detected);
        setMapping(detected ? {} : detectMapping(hdrs));
        toast.success(`Parsed ${res.data.length} rows`);
      },
      error: () => toast.error("Could not parse CSV"),
    });
  };

  const buildPreview = () => {
    const account = accounts[0];
    if (!account) return toast.error("No account configured");
    let fills;
    if (broker) {
      fills = broker.toFills(rows, headers);
    } else {
      const complete = FIELDS.filter((f) => f.required).every((f) => mapping[f.key]);
      if (!complete) return toast.error("Map all required columns first");
      fills = rowsToFills(rows, mapping as ColumnMapping);
    }
    if (fills.length === 0) return toast.error("No valid fills found — check the column mapping");
    setPreview(pairFillsToTrades(fills, account.id, account.charge_profile));
  };

  const doImport = async () => {
    if (!preview) return;
    const count = await importTrades.mutateAsync(preview);
    toast.success(`Imported ${count} trades (re-imports are deduped)`);
    setOpen(false);
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Upload className="h-3.5 w-3.5" /> Import CSV
      </Button>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import broker tradebook</DialogTitle>
          <DialogDescription>
            Upload the tradebook CSV from Zerodha Console, Upstox, Angel One, Dhan, Fyers or Groww.
            Buys and sells are auto-paired into round-trip trades.
          </DialogDescription>
        </DialogHeader>

        {headers.length === 0 && (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-sm text-muted hover:bg-surface-2">
            <Upload className="h-6 w-6" />
            Click to choose a CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
          </label>
        )}

        {headers.length > 0 && !preview && broker && (
          <div className="space-y-3">
            <div
              role="status"
              className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm"
            >
              <FileCheck className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              <span>
                Detected: <span className="font-medium">{broker.label}</span> · {rows.length} rows
              </span>
            </div>
            <Button className="w-full" onClick={buildPreview}>
              Preview trades
            </Button>
            <button
              type="button"
              className="w-full text-center text-xs text-muted underline-offset-2 hover:underline"
              onClick={() => {
                setBroker(null);
                setMapping(detectMapping(headers));
              }}
            >
              Not a {broker.name} file? Map columns manually
            </button>
          </div>
        )}

        {headers.length > 0 && !preview && !broker && (
          <div className="space-y-3">
            <p className="text-xs text-muted">{rows.length} rows · map your columns:</p>
            <div className="grid grid-cols-2 gap-3">
              {FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label>{f.label}</Label>
                  <Select
                    value={mapping[f.key] ?? ""}
                    onValueChange={(v) => setMapping((m) => ({ ...m, [f.key]: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      {headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <Button className="w-full" onClick={buildPreview}>
              Preview trades
            </Button>
          </div>
        )}

        {preview && (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="font-semibold">{preview.length}</span> round-trip trades detected ·
              Net <PnlText value={preview.reduce((s, t) => s + t.net_pnl, 0)} />
            </p>
            <div className="max-h-60 overflow-y-auto rounded-lg border divide-y text-sm">
              {preview.slice(0, 50).map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0 truncate text-xs">
                    {new Date(t.opened_at).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                    })}{" "}
                    <span className="font-medium">{t.symbol}</span>{" "}
                    {t.strike ? `${t.strike} ${t.option_type}` : t.segment} · {t.qty} qty
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span
                      className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted"
                      title={`${t.segment} · ${t.product ?? "MIS"}`}
                    >
                      {t.segment} {t.product ?? "MIS"}
                    </span>
                    {t.status === "closed" ? (
                      <PnlText value={t.net_pnl} className="text-xs" />
                    ) : (
                      <span className="text-xs text-warning">open</span>
                    )}
                  </span>
                </div>
              ))}
              {preview.length > 50 && (
                <div className="px-3 py-2 text-xs text-muted">…and {preview.length - 50} more</div>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setPreview(null)}>
                Back
              </Button>
              <Button className="flex-1" onClick={doImport} disabled={importTrades.isPending}>
                {importTrades.isPending ? "Importing…" : `Import ${preview.length} trades`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
