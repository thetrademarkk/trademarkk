/**
 * IndexedDB blob store — the FALLBACK layer-2 cache backend (07-data-layer.md §6),
 * used when OPFS is unavailable. Mirrors the open/get/put/delete IndexedDB pattern
 * the app already ships for the local sql.js DB (src/lib/db/adapters/local.ts):
 * one database, one object store, keyed binary blobs. Unlike OPFS there is no
 * directory tree — the slash-delimited cache key is just the primary key string.
 *
 * BROWSER-ONLY: touches `indexedDB`. Never import from node/server/vitest; the
 * cache policy (manifest, LRU, budget) is tested against a fake BlobStore.
 */

import { type BlobStore, QuotaError, asQuotaError } from "./blob-store";

/** Database + store names — namespaced alongside the existing local-DB store. */
export const IDB_NAME = "trademarkk-bt-cache";
export const IDB_STORE = "slices";
const IDB_VERSION = 1;

/** Open (creating the object store on first use) the cache database. */
function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // Blocked happens only if another tab holds an older version open; treat as a
    // failure so store.ts can fall back to no-cache rather than hang.
    req.onblocked = () => reject(new Error("IndexedDB open blocked by another tab"));
  });
}

/** The IndexedDB-backed BlobStore. */
export class IdbBlobStore implements BlobStore {
  readonly backend = "idb";

  async read(key: string): Promise<Uint8Array | null> {
    const db = await openIdb();
    try {
      return await new Promise<Uint8Array | null>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => {
          const v = req.result as ArrayBuffer | Uint8Array | undefined;
          if (v === undefined) return resolve(null);
          resolve(v instanceof Uint8Array ? v : new Uint8Array(v));
        };
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  }

  async write(key: string, bytes: Uint8Array): Promise<void> {
    const db = await openIdb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        // Store the raw ArrayBuffer slice (structured-clone-friendly, compact).
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        tx.objectStore(IDB_STORE).put(buf, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
      });
    } catch (err) {
      const quota = asQuotaError(err);
      throw quota ?? new QuotaError(`IndexedDB write failed for ${key}`, err);
    } finally {
      db.close();
    }
  }

  async delete(key: string): Promise<void> {
    const db = await openIdb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  async keys(): Promise<string[]> {
    const db = await openIdb();
    try {
      return await new Promise<string[]>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).getAllKeys();
        req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  }
}

/** True when this environment exposes IndexedDB. */
export function isIdbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}
