"use client";

import * as React from "react";
import { createLibsqlDb } from "@/lib/db/adapters/libsql";
import { createLocalDb } from "@/lib/db/adapters/local";
import { runMigrations } from "@/lib/db/migrations";
import {
  clearByodCreds,
  getStoredMode,
  loadByodCreds,
  saveByodCreds,
  setStoredMode,
  unlockByodCreds,
} from "@/lib/db/byod-store";
import type { ByodCredentials, DbClient, StorageMode } from "@/lib/db/types";

/**
 * The single most important abstraction in the app: resolves ONE DbClient for
 * whichever storage mode the user is in. Features below this provider never
 * know (or care) whether data lives in a hosted Turso DB, the user's own
 * Turso DB, or an in-browser SQLite file.
 */
export type DbSessionState =
  | { status: "loading" }
  | { status: "none" } // no mode chosen → onboarding
  | { status: "locked" } // BYOD creds encrypted with a passphrase
  | { status: "error"; message: string }
  | { status: "ready"; mode: StorageMode; db: DbClient };

interface DbSessionContextValue {
  state: DbSessionState;
  connectByod: (creds: ByodCredentials, passphrase?: string) => Promise<void>;
  unlockByod: (passphrase: string) => Promise<void>;
  startLocal: () => Promise<DbClient>;
  connectHosted: () => Promise<void>;
  disconnect: () => void;
}

const DbSessionContext = React.createContext<DbSessionContextValue | null>(null);

const HOSTED_CONN_KEY = "tm.hosted.conn";

async function validateAndMigrate(db: DbClient): Promise<void> {
  await db.execute("SELECT 1");
  await runMigrations(db);
}

async function getHostedConnection(): Promise<{ url: string; token: string }> {
  // Reuse a cached token while it's fresh (tokens are valid 24h; cache 24h).
  try {
    const cached = sessionStorage.getItem(HOSTED_CONN_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as { url: string; token: string; until: number };
      if (parsed.until > Date.now()) return parsed;
    }
  } catch {
    /* ignore cache */
  }
  let res = await fetch("/api/db/token", { method: "POST" });
  if (res.status === 404) {
    const prov = await fetch("/api/db/provision", { method: "POST" });
    if (!prov.ok) {
      const body = (await prov.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Could not provision your database");
    }
    res = await fetch("/api/db/token", { method: "POST" });
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Not signed in");
  }
  const data = (await res.json()) as { url: string; token: string };
  sessionStorage.setItem(
    HOSTED_CONN_KEY,
    JSON.stringify({ ...data, until: Date.now() + 24 * 3600 * 1000 })
  );
  return data;
}

export function DbSessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<DbSessionState>({ status: "loading" });
  // Dedupe concurrent hosted connects. The onboarding auto-connect effect and a
  // sign-up's onAuthed callback can both fire connectHosted() at once for a
  // brand-new user; without this they'd each POST /api/db/provision and race
  // (two Turso DBs created, the second insert hitting the user_id UNIQUE
  // constraint → a spurious 500). Sharing one in-flight promise serialises them.
  const hostedConnectInFlight = React.useRef<Promise<void> | null>(null);

  const connectByod = React.useCallback(async (creds: ByodCredentials, passphrase?: string) => {
    const db = createLibsqlDb(creds.url, creds.token);
    await validateAndMigrate(db);
    await saveByodCreds(creds, passphrase);
    setStoredMode("byod");
    setState({ status: "ready", mode: "byod", db });
  }, []);

  const unlockByod = React.useCallback(async (passphrase: string) => {
    const creds = await unlockByodCreds(passphrase);
    const db = createLibsqlDb(creds.url, creds.token);
    await validateAndMigrate(db);
    setState({ status: "ready", mode: "byod", db });
  }, []);

  const startLocal = React.useCallback(async () => {
    const db = await createLocalDb();
    await runMigrations(db);
    setStoredMode("local");
    setState({ status: "ready", mode: "local", db });
    return db;
  }, []);

  const connectHosted = React.useCallback(async () => {
    // Coalesce overlapping calls onto one provision/connect so a fresh signup
    // can't double-provision (see hostedConnectInFlight above).
    if (hostedConnectInFlight.current) return hostedConnectInFlight.current;
    const run = (async () => {
      const conn = await getHostedConnection();
      const db = createLibsqlDb(conn.url, conn.token);
      // Idempotent — keeps long-lived hosted DBs current after app upgrades.
      await runMigrations(db);
      setStoredMode("hosted");
      setState({ status: "ready", mode: "hosted", db });
    })();
    hostedConnectInFlight.current = run;
    try {
      await run;
    } finally {
      hostedConnectInFlight.current = null;
    }
  }, []);

  const disconnect = React.useCallback(() => {
    clearByodCreds();
    setStoredMode(null);
    sessionStorage.removeItem(HOSTED_CONN_KEY);
    setState({ status: "none" });
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const mode = getStoredMode();
      try {
        if (mode === "local") {
          await startLocal();
        } else if (mode === "byod") {
          const loaded = loadByodCreds();
          if (loaded.status === "plain") {
            const db = createLibsqlDb(loaded.creds.url, loaded.creds.token);
            await validateAndMigrate(db);
            if (!cancelled) setState({ status: "ready", mode: "byod", db });
          } else if (loaded.status === "locked") {
            if (!cancelled) setState({ status: "locked" });
          } else {
            if (!cancelled) setState({ status: "none" });
          }
        } else if (mode === "hosted") {
          await connectHosted();
        } else {
          if (!cancelled) setState({ status: "none" });
        }
      } catch (e) {
        if (!cancelled)
          setState({
            status: "error",
            message: e instanceof Error ? e.message : "Connection failed",
          });
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = React.useMemo(
    () => ({ state, connectByod, unlockByod, startLocal, connectHosted, disconnect }),
    [state, connectByod, unlockByod, startLocal, connectHosted, disconnect]
  );

  return <DbSessionContext.Provider value={value}>{children}</DbSessionContext.Provider>;
}

export function useDbSession(): DbSessionContextValue {
  const ctx = React.useContext(DbSessionContext);
  if (!ctx) throw new Error("useDbSession must be used within DbSessionProvider");
  return ctx;
}

/** For feature queries: returns the ready DbClient or throws (guarded by AppShell). */
export function useDb(): { db: DbClient; mode: StorageMode } {
  const { state } = useDbSession();
  if (state.status !== "ready") throw new Error("Database not connected");
  return { db: state.db, mode: state.mode };
}
