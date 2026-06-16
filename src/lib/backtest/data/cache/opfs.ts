/**
 * OPFS blob store — the PREFERRED layer-2 cache backend (07-data-layer.md §6).
 * Stores Arrow-IPC slice blobs under the Origin Private File System so large
 * binary payloads (resolved option series, index slices, coverage reports) live
 * efficiently and are reachable from a worker. IndexedDB (idb.ts) is the fallback
 * when OPFS is unavailable (older Safari, some private modes).
 *
 * This module is BROWSER-ONLY: it touches `navigator.storage.getDirectory()`. It
 * must never be imported from node/server code or a vitest unit test. The cache
 * POLICY (manifest, LRU, budget) lives in keys.ts/store.ts and IS tested with a
 * fake BlobStore — this file is the thin physical adapter only.
 *
 * Layout (§6): a single root directory `tmk-bt-cache`; each cache key
 * (`v1/opt/NIFTY/2026-01-29/21500-CE/1m.arrow`) maps to nested OPFS directories
 * with the final segment as the file. The manifest.json lives at the root.
 */

import { type BlobStore, QuotaError, asQuotaError } from "./blob-store";

/** Root OPFS directory for the backtest slice cache (§6 layout). */
export const OPFS_ROOT = "tmk-bt-cache";

/** True when this environment exposes OPFS (so store.ts can pick a backend). */
export function isOpfsAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.storage &&
    typeof navigator.storage.getDirectory === "function"
  );
}

/** Get (creating if needed) the cache root directory handle. */
async function rootDir(): Promise<FileSystemDirectoryHandle> {
  const base = await navigator.storage.getDirectory();
  return base.getDirectoryHandle(OPFS_ROOT, { create: true });
}

/**
 * Walk the slash-delimited key to its parent directory handle, creating
 * directories when `create` is set. Returns the parent handle + the final
 * filename segment. A key always has at least one segment.
 */
async function resolveParent(
  key: string,
  create: boolean
): Promise<{ parent: FileSystemDirectoryHandle; name: string } | null> {
  const segments = key.split("/").filter((s) => s.length > 0);
  const name = segments.pop();
  if (name === undefined) return null;
  let dir = await rootDir();
  for (const seg of segments) {
    try {
      dir = await dir.getDirectoryHandle(seg, { create });
    } catch {
      if (!create) return null; // missing intermediate dir on a read → absent
      throw new QuotaError(`OPFS: cannot create directory ${seg}`);
    }
  }
  return { parent: dir, name };
}

/** The OPFS-backed BlobStore. Instantiated lazily by store.ts when OPFS exists. */
export class OpfsBlobStore implements BlobStore {
  readonly backend = "opfs";

  async read(key: string): Promise<Uint8Array | null> {
    const loc = await resolveParent(key, false);
    if (!loc) return null;
    try {
      const fileHandle = await loc.parent.getFileHandle(loc.name, { create: false });
      const file = await fileHandle.getFile();
      const buf = await file.arrayBuffer();
      return new Uint8Array(buf);
    } catch {
      // NotFoundError (absent) or any read fault → treat as a cache miss.
      return null;
    }
  }

  async write(key: string, bytes: Uint8Array): Promise<void> {
    const loc = await resolveParent(key, true);
    if (!loc) throw new QuotaError(`OPFS: invalid cache key ${key}`);
    try {
      const fileHandle = await loc.parent.getFileHandle(loc.name, { create: true });
      const writable = await fileHandle.createWritable();
      try {
        // Write a plain ArrayBuffer copy: this both detaches us from any
        // SharedArrayBuffer-backed worker view and satisfies the DOM write type
        // (FileSystemWriteChunkType requires an ArrayBuffer-backed source).
        const copy = bytes.slice().buffer;
        await writable.write(copy);
      } finally {
        await writable.close();
      }
    } catch (err) {
      const quota = asQuotaError(err);
      if (quota) throw quota;
      // A non-quota write fault still degrades to no-cache for this slice; wrap so
      // store.ts can disable the cache for the session.
      throw new QuotaError(`OPFS write failed for ${key}`, err);
    }
  }

  async delete(key: string): Promise<void> {
    const loc = await resolveParent(key, false);
    if (!loc) return;
    try {
      await loc.parent.removeEntry(loc.name);
    } catch {
      // Already gone — idempotent.
    }
  }

  async keys(): Promise<string[]> {
    const out: string[] = [];
    const root = await rootDir();
    await walk(root, "", out);
    return out;
  }
}

/** Recursively collect every file path under `dir`, relative to the cache root. */
async function walk(dir: FileSystemDirectoryHandle, prefix: string, out: string[]): Promise<void> {
  // `entries()` is async-iterable on FileSystemDirectoryHandle.
  const iter = (
    dir as unknown as {
      entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    }
  ).entries();
  for await (const [name, handle] of iter) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      await walk(handle as FileSystemDirectoryHandle, path, out);
    } else {
      out.push(path);
    }
  }
}
