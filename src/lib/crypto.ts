/** WebCrypto AES-GCM encryption for BYOD credentials at rest (optional passphrase). */

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
function fromB64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 250_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptJson(value: unknown, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    enc.encode(JSON.stringify(value))
  );
  return [toB64(salt), toB64(iv), toB64(new Uint8Array(ct))].join(".");
}

export async function decryptJson<T>(payload: string, passphrase: string): Promise<T> {
  const [saltB64, ivB64, ctB64] = payload.split(".");
  if (!saltB64 || !ivB64 || !ctB64) throw new Error("Malformed encrypted payload");
  const key = await deriveKey(passphrase, fromB64(saltB64));
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(ivB64) as BufferSource },
    key,
    fromB64(ctB64) as BufferSource
  );
  return JSON.parse(dec.decode(pt)) as T;
}
