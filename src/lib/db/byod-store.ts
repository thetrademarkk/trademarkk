import { decryptJson, encryptJson } from "@/lib/crypto";
import type { ByodCredentials, StorageMode } from "./types";

/**
 * BYOD credentials live ONLY in the browser. Optionally encrypted at rest with a
 * user passphrase (AES-GCM via WebCrypto). They are never sent to our servers.
 */
const CREDS_KEY = "tm.byod.creds";
const MODE_KEY = "tm.mode";

type StoredCreds = { v: 1; plain?: ByodCredentials; enc?: string };

export async function saveByodCreds(creds: ByodCredentials, passphrase?: string): Promise<void> {
  const payload: StoredCreds = passphrase
    ? { v: 1, enc: await encryptJson(creds, passphrase) }
    : { v: 1, plain: creds };
  localStorage.setItem(CREDS_KEY, JSON.stringify(payload));
}

export type ByodLoadResult =
  | { status: "none" }
  | { status: "plain"; creds: ByodCredentials }
  | { status: "locked" };

export function loadByodCreds(): ByodLoadResult {
  const raw = localStorage.getItem(CREDS_KEY);
  if (!raw) return { status: "none" };
  try {
    const stored = JSON.parse(raw) as StoredCreds;
    if (stored.plain) return { status: "plain", creds: stored.plain };
    if (stored.enc) return { status: "locked" };
  } catch {
    /* corrupted — treat as none */
  }
  return { status: "none" };
}

export async function unlockByodCreds(passphrase: string): Promise<ByodCredentials> {
  const raw = localStorage.getItem(CREDS_KEY);
  if (!raw) throw new Error("No saved connection");
  const stored = JSON.parse(raw) as StoredCreds;
  if (!stored.enc) throw new Error("Connection is not encrypted");
  return decryptJson<ByodCredentials>(stored.enc, passphrase);
}

export function clearByodCreds(): void {
  localStorage.removeItem(CREDS_KEY);
}

export function getStoredMode(): StorageMode | null {
  const m = localStorage.getItem(MODE_KEY);
  return m === "hosted" || m === "byod" || m === "local" ? m : null;
}

export function setStoredMode(mode: StorageMode | null): void {
  if (mode) localStorage.setItem(MODE_KEY, mode);
  else localStorage.removeItem(MODE_KEY);
}

/** Connection-key export for multi-device setup (QR / file). */
export function exportConnectionKey(creds: ByodCredentials): string {
  return btoa(JSON.stringify({ v: 1, ...creds }));
}

export function importConnectionKey(key: string): ByodCredentials {
  const parsed = JSON.parse(atob(key.trim())) as { v: number; url: string; token: string };
  if (!parsed.url || !parsed.token) throw new Error("Invalid connection key");
  return { url: parsed.url, token: parsed.token };
}
