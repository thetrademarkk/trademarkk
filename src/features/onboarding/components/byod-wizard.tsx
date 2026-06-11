"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { useDbSession } from "@/providers/db-session-provider";
import { importConnectionKey } from "@/lib/db/byod-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DASHBOARD_STEPS = [
  <>
    Create a free account at{" "}
    <a
      className="text-accent underline"
      href="https://app.turso.tech"
      target="_blank"
      rel="noreferrer"
    >
      app.turso.tech
    </a>{" "}
    (no card needed).
  </>,
  <>
    Click <strong>Databases → Create Database</strong>, name it (e.g.{" "}
    <code className="rounded bg-surface-2 px-1 text-xs">my-journal</code>) and create it.
  </>,
  <>
    Open the database — copy its <strong>URL</strong> (starts with{" "}
    <code className="rounded bg-surface-2 px-1 text-xs">libsql://</code>).
  </>,
  <>
    Click <strong>Generate Token</strong> (read &amp; write) and copy it.
  </>,
];

const CLI_STEPS = [
  <>
    Install the CLI &amp; sign up:{" "}
    <code className="rounded bg-surface-2 px-1 text-xs">turso auth signup</code>
  </>,
  <>
    Create a database:{" "}
    <code className="rounded bg-surface-2 px-1 text-xs">turso db create my-journal</code>
  </>,
  <>
    Copy the URL:{" "}
    <code className="rounded bg-surface-2 px-1 text-xs">turso db show my-journal --url</code>
  </>,
  <>
    Create a token:{" "}
    <code className="rounded bg-surface-2 px-1 text-xs">turso db tokens create my-journal</code>
  </>,
];

/** Connect-your-own-Turso wizard. Credentials never leave this browser. */
export function ByodWizard({ onConnected }: { onConnected: () => void }) {
  const { connectByod } = useDbSession();
  const [url, setUrl] = React.useState("");
  const [token, setToken] = React.useState("");
  const [passphrase, setPassphrase] = React.useState("");
  const [importKey, setImportKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const connect = async (u: string, t: string) => {
    setBusy(true);
    try {
      await connectByod({ url: u.trim(), token: t.trim() }, passphrase || undefined);
      toast.success("Connected to your database");
      onConnected();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not connect — check URL and token");
    } finally {
      setBusy(false);
    }
  };

  const Steps = ({ items }: { items: React.ReactNode[] }) => (
    <ol className="space-y-2 text-sm text-muted">
      {items.map((s, i) => (
        <li key={i} className="flex gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
            {i + 1}
          </span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="space-y-4">
      <Steps items={DASHBOARD_STEPS} />
      <details className="rounded-lg border bg-surface-2/40 px-3 py-2">
        <summary className="text-xs font-medium text-muted hover:text-foreground">
          Prefer the terminal? CLI steps
        </summary>
        <div className="pt-3">
          <Steps items={CLI_STEPS} />
        </div>
      </details>

      <div className="space-y-3">
        <div className="space-y-1">
          <Label>Database URL</Label>
          <Input
            placeholder="libsql://my-journal-yourname.turso.io"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>Auth token</Label>
          <Input
            type="password"
            placeholder="eyJhbGciOi…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>Lock with a passphrase (optional, recommended on shared devices)</Label>
          <Input
            type="password"
            placeholder="Encrypts the saved connection in this browser"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </div>
        <Button
          className="w-full"
          disabled={busy || !url || !token}
          onClick={() => connect(url, token)}
        >
          {busy ? "Connecting…" : "Connect database"}
        </Button>
      </div>

      <div className="border-t pt-3 space-y-2">
        <Label>Already set up on another device? Paste your connection key:</Label>
        <div className="flex gap-2">
          <Input
            value={importKey}
            onChange={(e) => setImportKey(e.target.value)}
            placeholder="Connection key"
          />
          <Button
            variant="outline"
            disabled={busy || !importKey}
            onClick={() => {
              try {
                const creds = importConnectionKey(importKey);
                void connect(creds.url, creds.token);
              } catch {
                toast.error("Invalid connection key");
              }
            }}
          >
            Import
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted">
        <Lock className="mr-1 inline h-3 w-3" aria-hidden />
        Your URL and token are stored only in this browser — they are never sent to our servers.
        Every query goes directly from your browser to your database.
      </p>
    </div>
  );
}
