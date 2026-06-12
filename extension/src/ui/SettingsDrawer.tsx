import * as React from "react";
import { ExternalLink, LogOut, X } from "lucide-react";
import { openAppTab, signOut } from "../lib/app-api";
import { DEFAULT_APP_URL, normalizeAppUrl, setAppUrl } from "../lib/config";

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
