import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  CircleAlert,
  Database,
  ExternalLink,
  LogIn,
  MonitorSmartphone,
  RefreshCw,
} from "lucide-react";
import { openAppTab } from "../lib/app-api";

export function LoadingState({ label = "Connecting to your journal" }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <div className="spinner" />
      <p>{label}…</p>
    </div>
  );
}

function StateShell({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="state">
      <div className="state-icon">
        <Icon size={22} />
      </div>
      <h2>{title}</h2>
      <p>{body}</p>
      {children}
    </div>
  );
}

export function SignedOutState({ appUrl }: { appUrl: string }) {
  return (
    <StateShell
      icon={LogIn}
      title="Sign in to TradeMarkk"
      body="Sign in once on the web app — this panel picks up your session automatically."
    >
      <button
        type="button"
        className="btn-primary"
        onClick={() => openAppTab(appUrl, "/app/onboarding")}
      >
        <LogIn size={15} />
        Sign in to TradeMarkk
      </button>
    </StateShell>
  );
}

export function SetupIncompleteState({ appUrl }: { appUrl: string }) {
  return (
    <StateShell
      icon={MonitorSmartphone}
      title="Finish setup in the web app"
      body="Your journal isn't connected to TradeMarkk cloud yet. The extension works with Hosted or BYOD storage — local-mode journals live inside the web app's browser storage and can't be reached from here."
    >
      <button type="button" className="btn-primary" onClick={() => openAppTab(appUrl)}>
        <ExternalLink size={15} />
        Open TradeMarkk
      </button>
    </StateShell>
  );
}

export function SchemaOutdatedState({ appUrl }: { appUrl: string }) {
  return (
    <StateShell
      icon={Database}
      title="Journal needs an update"
      body="Open the web app once — it updates your database automatically, then come back here."
    >
      <button type="button" className="btn-primary" onClick={() => openAppTab(appUrl)}>
        <ExternalLink size={15} />
        Open TradeMarkk
      </button>
    </StateShell>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <StateShell icon={CircleAlert} title="Something went wrong" body={message}>
      <button type="button" className="btn-primary" onClick={onRetry}>
        <RefreshCw size={15} />
        Retry
      </button>
    </StateShell>
  );
}
