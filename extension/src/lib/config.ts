/** Extension-side settings (chrome.storage.local). */

export const DEFAULT_APP_URL = "https://trademark-smoky.vercel.app";

/**
 * Normalizes a user-entered app URL to a bare origin.
 * https is required except for localhost/127.0.0.1 (self-hosters developing
 * locally); a missing protocol defaults to https (http for localhost).
 * Returns null when the input can't become a usable origin.
 */
export function normalizeAppUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(v)
    ? v
    : `${/^(localhost|127\.0\.0\.1)([:/]|$)/i.test(v) ? "http" : "https"}://${v}`;
  try {
    const u = new URL(withProtocol);
    const isLoopback = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && isLoopback)) return null;
    if (!u.hostname) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export async function getAppUrl(): Promise<string> {
  const stored = await chrome.storage.local.get("appUrl");
  return typeof stored.appUrl === "string" && stored.appUrl ? stored.appUrl : DEFAULT_APP_URL;
}

export async function setAppUrl(origin: string): Promise<void> {
  if (origin === DEFAULT_APP_URL) await chrome.storage.local.remove("appUrl");
  else await chrome.storage.local.set({ appUrl: origin });
}

export interface ByodCreds {
  url: string;
  token: string;
}

export async function getByodCreds(): Promise<ByodCreds | null> {
  const stored = await chrome.storage.local.get("byodCreds");
  const c = stored.byodCreds as ByodCreds | undefined;
  return c && typeof c.url === "string" && typeof c.token === "string" ? c : null;
}

export async function setByodCreds(creds: ByodCreds | null): Promise<void> {
  if (creds) await chrome.storage.local.set({ byodCreds: creds });
  else await chrome.storage.local.remove("byodCreds");
}
