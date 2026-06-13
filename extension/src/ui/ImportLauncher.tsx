import * as React from "react";
import { Download } from "lucide-react";
import { kitePositionsAdapter } from "../brokers/kite-positions";
import { isImportEnabled } from "../lib/capture";
import { ImportModal } from "./ImportModal";

/**
 * The "Import from Kite" entry point — only shown once the user has enabled
 * Kite tradebook import in Settings (the content script that reads the page is
 * registered there). Opening it launches the preview/import modal.
 */
export function ImportLauncher({ appUrl }: { appUrl: string }) {
  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    void isImportEnabled(kitePositionsAdapter).then((v) => active && setEnabled(v));
    return () => {
      active = false;
    };
  }, []);

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        className="import-entry"
        onClick={() => setOpen(true)}
        data-testid="import-launch"
      >
        <Download size={14} />
        Import from {kitePositionsAdapter.label}
      </button>
      {open && <ImportModal appUrl={appUrl} onClose={() => setOpen(false)} />}
    </>
  );
}
