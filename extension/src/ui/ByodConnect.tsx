import * as React from "react";
import { Database } from "lucide-react";
import { setByodCreds } from "../lib/config";

/**
 * BYOD journals live in the user's own Turso database — the extension asks
 * for the same URL + token once and keeps them in chrome.storage.local
 * (mirroring how the web app keeps them in the browser's local storage).
 */
export function ByodConnect({ onConnected }: { onConnected: () => void }) {
  const [url, setUrl] = React.useState("");
  const [token, setToken] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const connect = async () => {
    setBusy(true);
    await setByodCreds({ url: url.trim(), token: token.trim() });
    onConnected(); // validation happens during connect; failures land in the error state
  };

  return (
    <div className="state">
      <div className="state-icon">
        <Database size={22} />
      </div>
      <h2>Connect your Turso database</h2>
      <p>
        Your journal is in BYOD mode. Paste the same database URL and token you connected in the web
        app — they stay in this browser only.
      </p>
      <div
        style={{ width: "100%", maxWidth: 280, display: "flex", flexDirection: "column", gap: 8 }}
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="libsql://your-db.turso.io"
          spellCheck={false}
          aria-label="Database URL"
        />
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Database auth token"
          type="password"
          aria-label="Database auth token"
        />
        <button
          type="button"
          className="btn-primary"
          onClick={connect}
          disabled={busy || !url.trim() || !token.trim()}
        >
          Connect
        </button>
      </div>
    </div>
  );
}
