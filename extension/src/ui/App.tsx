import * as React from "react";
import { Settings } from "lucide-react";
import type { DbClient } from "@/lib/db/types";
import {
  AppUnreachableError,
  clearHostedConnectionCache,
  fetchStatus,
  type AppStatus,
} from "../lib/app-api";
import { getAppUrl, setByodCreds } from "../lib/config";
import { ByodConnectError, resolveConnection } from "../lib/connection";
import { DbProvider } from "../lib/journal";
import { BrandMark } from "./Brand";
import { ByodConnect } from "./ByodConnect";
import { GlanceStrip } from "./GlanceStrip";
import { ImportLauncher } from "./ImportLauncher";
import { RulesCard } from "./RulesCard";
import { SettingsDrawer } from "./SettingsDrawer";
import { TradeForm } from "./TradeForm";
import {
  ErrorState,
  LoadingState,
  SchemaOutdatedState,
  SetupIncompleteState,
  SignedOutState,
} from "./states";

type PanelState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "signed-out" }
  | { phase: "setup-incomplete" }
  | { phase: "needs-byod-creds" }
  | { phase: "schema-outdated" }
  | { phase: "ready"; db: DbClient; mode: "hosted" | "byod" };

const SIGNED_OUT_POLL_MS = 3000;

export function App() {
  const [appUrl, setAppUrlState] = React.useState<string | null>(null);
  const [state, setState] = React.useState<PanelState>({ phase: "loading" });
  const [user, setUser] = React.useState<AppStatus["user"]>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const generation = React.useRef(0);

  const boot = React.useCallback(async () => {
    const gen = ++generation.current;
    const url = await getAppUrl();
    if (gen !== generation.current) return;
    setAppUrlState(url);
    setState({ phase: "loading" });
    try {
      const status = await fetchStatus(url);
      if (gen !== generation.current) return;
      setUser(status.user);
      if (!status.signedIn) {
        setState({ phase: "signed-out" });
        return;
      }
      const conn = await resolveConnection(url, status);
      if (gen !== generation.current) return;
      if (conn.kind === "ready") setState({ phase: "ready", db: conn.db, mode: conn.mode });
      else if (conn.kind === "needs-byod-creds") setState({ phase: "needs-byod-creds" });
      else if (conn.kind === "schema-outdated") setState({ phase: "schema-outdated" });
      else setState({ phase: "setup-incomplete" });
    } catch (e) {
      if (gen !== generation.current) return;
      if (e instanceof AppUnreachableError) {
        setState({ phase: "error", message: `${e.message}. Is the app URL right?` });
      } else if (e instanceof ByodConnectError) {
        // Revoked token / deleted DB — drop the dead creds, ask again.
        await setByodCreds(null);
        setState({ phase: "needs-byod-creds" });
      } else {
        // A stale vended token can fail mid-connect — clear the cache and
        // surface a retry rather than a dead panel.
        await clearHostedConnectionCache(url);
        setState({
          phase: "error",
          message: e instanceof Error ? e.message : "Could not connect to your journal",
        });
      }
    }
  }, []);

  React.useEffect(() => {
    void boot();
  }, [boot]);

  // Poll while the user signs in / finishes onboarding on the web tab we
  // opened — the panel flips to ready on its own, no manual refresh.
  React.useEffect(() => {
    if (state.phase !== "signed-out" && state.phase !== "setup-incomplete") return;
    const t = setInterval(() => void boot(), SIGNED_OUT_POLL_MS);
    return () => clearInterval(t);
  }, [state.phase, boot]);

  if (!appUrl || state.phase === "loading") {
    return (
      <div className="panel">
        <Header onSettings={() => setSettingsOpen(true)} />
        <LoadingState />
        {settingsOpen && appUrl && (
          <SettingsDrawer
            appUrl={appUrl}
            userEmail={null}
            onClose={() => setSettingsOpen(false)}
            onChanged={() => void boot()}
          />
        )}
      </div>
    );
  }

  return (
    <div className="panel">
      <Header onSettings={() => setSettingsOpen(true)}>
        {state.phase === "ready" && (
          <DbProvider value={state.db}>
            <GlanceStrip />
          </DbProvider>
        )}
      </Header>

      {state.phase === "signed-out" && <SignedOutState appUrl={appUrl} />}
      {state.phase === "setup-incomplete" && <SetupIncompleteState appUrl={appUrl} />}
      {state.phase === "schema-outdated" && <SchemaOutdatedState appUrl={appUrl} />}
      {state.phase === "needs-byod-creds" && <ByodConnect onConnected={() => void boot()} />}
      {state.phase === "error" && (
        <ErrorState message={state.message} onRetry={() => void boot()} />
      )}

      {state.phase === "ready" && (
        <DbProvider value={state.db}>
          <main className="panel-main">
            <TradeForm appUrl={appUrl} />
            <ImportLauncher appUrl={appUrl} />
            <RulesCard appUrl={appUrl} />
          </main>
        </DbProvider>
      )}

      {settingsOpen && (
        <SettingsDrawer
          appUrl={appUrl}
          userEmail={user?.email ?? null}
          onClose={() => setSettingsOpen(false)}
          onChanged={() => void boot()}
        />
      )}
    </div>
  );
}

function Header({ children, onSettings }: { children?: React.ReactNode; onSettings: () => void }) {
  return (
    <header className="panel-header">
      <span className="brand">
        <BrandMark />
        TradeMark
      </span>
      {children}
      <button
        type="button"
        className="icon-btn"
        onClick={onSettings}
        aria-label="Settings"
        style={children ? undefined : { marginLeft: "auto" }}
      >
        <Settings size={16} />
      </button>
    </header>
  );
}
