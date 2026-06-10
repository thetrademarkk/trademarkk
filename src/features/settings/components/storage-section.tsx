"use client";

import * as React from "react";
import { Copy, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useDb } from "@/providers/db-session-provider";
import { exportConnectionKey, loadByodCreds } from "@/lib/db/byod-store";
import { toDateKey } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ModeSwitchWizard } from "@/features/migration";
import { downloadFile, exportBackup, exportTradesCsv, importBackup } from "../backup";

const MODE_LABELS = { hosted: "Hosted (we store it)", byod: "Your own database", local: "This browser only" };

export function StorageSection() {
  const { db, mode } = useDb();
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);

  const copyConnectionKey = () => {
    const loaded = loadByodCreds();
    if (loaded.status !== "plain") {
      toast.error("Connection key export needs an unencrypted saved connection");
      return;
    }
    void navigator.clipboard.writeText(exportConnectionKey(loaded.creds));
    toast.success("Connection key copied — paste it on your other device");
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Storage & data</CardTitle>
        <Badge variant="secondary">{MODE_LABELS[mode]}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <ModeSwitchWizard />
          {mode === "byod" && (
            <Button variant="outline" size="sm" onClick={copyConnectionKey}>
              <Copy className="h-3.5 w-3.5" /> Copy connection key
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                downloadFile(`trademark-backup-${toDateKey(new Date())}.json`, await exportBackup(db));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Download className="h-3.5 w-3.5" /> Backup (JSON)
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const csv = await exportTradesCsv(db);
                if (!csv) toast.info("No trades to export yet");
                else downloadFile(`trademark-trades-${toDateKey(new Date())}.csv`, csv, "text/csv");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Download className="h-3.5 w-3.5" /> Trades CSV
          </Button>
          <label>
            <Button variant="outline" size="sm" asChild>
              <span className="cursor-pointer">
                <Upload className="h-3.5 w-3.5" /> Restore backup
              </span>
            </Button>
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const count = await importBackup(db, await f.text());
                  await qc.invalidateQueries();
                  toast.success(`Restored ${count} rows`);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Restore failed");
                }
              }}
            />
          </label>
        </div>
        <p className="text-xs text-muted">
          {mode === "byod" &&
            "Your credentials live only in this browser. Every query goes directly to your database."}
          {mode === "hosted" &&
            "Your journal lives in an isolated database that only your login can access. You can move to your own database anytime."}
          {mode === "local" &&
            "Data is stored in this browser (IndexedDB). Switch to hosted or your own database to access it from other devices."}
        </p>
      </CardContent>
    </Card>
  );
}
