/**
 * Calls to the TradeMark app's API using the user's existing cookie session.
 * Chrome treats extension-initiated requests as same-site for origins the
 * extension holds host permissions on, so the SameSite=Lax session cookie is
 * attached — the extension itself never stores credentials.
 */

export interface AppStatus {
  signedIn: boolean;
  user: { id: string; email: string; name: string } | null;
  storageMode: "hosted" | "byod" | null;
  provisioned: boolean;
}

export class AppUnreachableError extends Error {
  constructor(appUrl: string) {
    super(`Could not reach ${appUrl}`);
    this.name = "AppUnreachableError";
  }
}

export async function fetchStatus(appUrl: string): Promise<AppStatus> {
  let res: Response;
  try {
    // Timeout keeps a wrong/unreachable app URL from hanging the panel —
    // the error state (with settings access) must appear quickly.
    res = await fetch(`${appUrl}/api/db/status`, {
      credentials: "include",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AppUnreachableError(appUrl);
  }
  if (res.status === 401)
    return { signedIn: false, user: null, storageMode: null, provisioned: false };
  if (!res.ok) throw new Error(`Status check failed (${res.status})`);
  const data = (await res.json()) as {
    user: AppStatus["user"];
    storageMode: AppStatus["storageMode"];
    provisioned: boolean;
  };
  return {
    signedIn: true,
    user: data.user,
    storageMode: data.storageMode,
    provisioned: Boolean(data.provisioned),
  };
}

interface HostedConn {
  url: string;
  token: string;
  until: number;
}

const connKey = (appUrl: string) => `hostedConn:${appUrl}`;

/**
 * Mints (or reuses) a token for the user's own hosted Turso DB — the same
 * token-vending flow the web client uses (tokens valid 7 days; cached 24h in
 * chrome.storage.session so it never outlives the browser session).
 */
export async function fetchHostedConnection(
  appUrl: string
): Promise<{ url: string; token: string }> {
  try {
    const cached = (await chrome.storage.session.get(connKey(appUrl)))[connKey(appUrl)] as
      | HostedConn
      | undefined;
    if (cached && cached.until > Date.now()) return cached;
  } catch {
    /* session storage unavailable — mint fresh */
  }
  let res = await fetch(`${appUrl}/api/db/token`, { method: "POST", credentials: "include" });
  if (res.status === 404) {
    const prov = await fetch(`${appUrl}/api/db/provision`, {
      method: "POST",
      credentials: "include",
    });
    if (!prov.ok) {
      const body = (await prov.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Could not provision your database");
    }
    res = await fetch(`${appUrl}/api/db/token`, { method: "POST", credentials: "include" });
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Could not connect to your journal");
  }
  const data = (await res.json()) as { url: string; token: string };
  const entry: HostedConn = { ...data, until: Date.now() + 24 * 3600 * 1000 };
  await chrome.storage.session.set({ [connKey(appUrl)]: entry }).catch(() => undefined);
  return data;
}

export async function clearHostedConnectionCache(appUrl: string): Promise<void> {
  await chrome.storage.session.remove(connKey(appUrl)).catch(() => undefined);
}

export async function signOut(appUrl: string): Promise<void> {
  await fetch(`${appUrl}/api/auth/sign-out`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  await clearHostedConnectionCache(appUrl);
}

export function openAppTab(appUrl: string, path = "/app"): void {
  void chrome.tabs.create({ url: `${appUrl}${path}` });
}
