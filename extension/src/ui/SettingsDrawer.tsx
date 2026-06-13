import * as React from "react";
import { ExternalLink, LogOut, X } from "lucide-react";
import { captureAdapters } from "../brokers";
import type { BrokerCaptureAdapter } from "../brokers/types";
import { kitePositionsAdapter } from "../brokers/kite-positions";
import { openAppTab, signOut } from "../lib/app-api";
import {
  disableCapture,
  disableImport,
  enableCapture,
  enableImport,
  isCaptureEnabled,
  isImportEnabled,
} from "../lib/capture";
import { DEFAULT_APP_URL, getAppUrl, normalizeAppUrl, setAppUrl } from "../lib/config";

/**
 * Settings: app URL (default prod; self-hosters point at their own deploy —
 * non-default https origins request a runtime host permission) and sign out.
 */
export function SettingsDrawer({
  appUrl,
  userEmail,
  onClose,
  onChanged,
}: {
  appUrl: string;
  userEmail: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [urlInput, setUrlInput] = React.useState(appUrl);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const version = chrome.runtime.getManifest().version;

  const saveUrl = async () => {
    setError(null);
    const origin = normalizeAppUrl(urlInput);
    if (!origin) {
      setError("Enter a valid https:// URL (http allowed for localhost).");
      return;
    }
    setBusy(true);
    try {
      const pattern = `${origin}/*`;
      const granted =
        (await chrome.permissions.contains({ origins: [pattern] })) ||
        (await chrome.permissions.request({ origins: [pattern] }));
      if (!granted) {
        setError("Chrome permission for that origin was declined.");
        return;
      }
      await setAppUrl(origin);
      // Read-back verify: a just-installed extension page can drop its first
      // storage.local write without an error — surface it instead of closing
      // the drawer while the panel still points at the old URL.
      if ((await getAppUrl()) !== origin) {
        setError("Chrome didn't persist the URL — try Save again.");
        return;
      }
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the URL");
    } finally {
      setBusy(false);
    }
  };

  const doSignOut = async () => {
    setBusy(true);
    try {
      await signOut(appUrl);
      onChanged();
      onClose();
    } catch {
      setError("Sign out failed — check your connection.");
      setBusy(false);
    }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="drawer" role="dialog" aria-label="Settings">
        <h2>
          Settings
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings">
            <X size={16} />
          </button>
        </h2>

        {userEmail && <div className="who">Signed in as {userEmail}</div>}

        <div className="section">
          <label htmlFor="tm-app-url" className="hint">
            TradeMark app URL
          </label>
          <input
            id="tm-app-url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder={DEFAULT_APP_URL}
            spellCheck={false}
          />
          <p className="hint">
            TradeMark is open source — self-hosters can point the extension at their own deployment.
          </p>
          {error && (
            <p className="hint" style={{ color: "var(--loss)" }} role="alert">
              {error}
            </p>
          )}
          <button type="button" className="btn-ghost" onClick={saveUrl} disabled={busy}>
            Save URL
          </button>
        </div>

        <div className="section">
          <span className="hint">Broker capture</span>
          {captureAdapters.map((a) => (
            <CaptureToggle key={a.id} adapter={a} />
          ))}
          <p className="hint">
            Adds a &ldquo;Log in TradeMark&rdquo; button to the broker&rsquo;s order window that
            prefills the quick log. Reads only the order fields you can see — never holdings,
            positions or balances. Chrome asks for your permission once.
          </p>
        </div>

        <div className="section">
          <span className="hint">Tradebook import</span>
          <ImportToggle />
          <p className="hint">
            Reads your executed orders straight from the Kite Orders/Positions page so you can
            import them in one click — deduped against your journal. Reads only the trade fields
            (instrument, side, qty, price, time) — never balances or holdings.
          </p>
        </div>

        <div className="footer">
          <button type="button" className="btn-ghost" onClick={() => openAppTab(appUrl)}>
            <ExternalLink size={13} />
            Open TradeMark
          </button>
          {userEmail && (
            <button type="button" className="btn-ghost" onClick={doSignOut} disabled={busy}>
              <LogOut size={13} />
              Sign out
            </button>
          )}
          <div className="version">TradeMark extension v{version}</div>
        </div>
      </div>
    </>
  );
}

/**
 * One broker's capture switch. "Enabled" is read straight from Chrome's
 * content-script registration (no shadow state); enabling runs inside the
 * click gesture because chrome.permissions.request requires one.
 */
function CaptureToggle({ adapter }: { adapter: BrokerCaptureAdapter }) {
  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void isCaptureEnabled(adapter).then(setEnabled);
  }, [adapter]);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (enabled) {
        await disableCapture(adapter);
        setEnabled(false);
      } else {
        await enableCapture(adapter);
        setEnabled(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update broker capture");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="capture-row">
        <span>{adapter.label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled === true}
          aria-label={`Capture on ${adapter.label}`}
          className={`capture-switch${enabled ? " on" : ""}`}
          onClick={toggle}
          disabled={busy || enabled === null}
        >
          {enabled ? "On" : "Off"}
        </button>
      </div>
      {error && (
        <p className="hint" style={{ color: "var(--loss)" }} role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * Kite tradebook-import switch. Mirrors CaptureToggle: "enabled" is read from
 * Chrome's content-script registration, and enabling runs inside the click
 * gesture (chrome.permissions.request needs one).
 */
function ImportToggle() {
  const adapter = kitePositionsAdapter;
  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void isImportEnabled(adapter).then(setEnabled);
  }, [adapter]);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (enabled) {
        await disableImport(adapter);
        setEnabled(false);
      } else {
        await enableImport(adapter);
        setEnabled(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update tradebook import");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="capture-row">
        <span>{adapter.label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled === true}
          aria-label={`Tradebook import from ${adapter.label}`}
          className={`capture-switch${enabled ? " on" : ""}`}
          onClick={toggle}
          disabled={busy || enabled === null}
        >
          {enabled ? "On" : "Off"}
        </button>
      </div>
      {error && (
        <p className="hint" style={{ color: "var(--loss)" }} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
