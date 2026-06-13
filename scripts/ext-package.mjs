/**
 * Chrome Web Store packaging pipeline for the TradeMarkk extension.
 *
 * Builds the MV3 bundle (`npm run ext:build`), validates the manifest against
 * the store's hard requirements, then zips the *contents* of extension/dist at
 * the archive root (manifest.json at the top level — what the Web Store
 * expects) into a versioned `extension/dist/trademarkk-extension-v<version>.zip`.
 *
 * Cred-free: this produces the upload artifact only. The actual store
 * submission needs the owner's $5 Chrome Web Store developer account and is
 * NOT performed here.
 *
 * Usage:
 *   npm run ext:package            # build + validate + zip
 *   node scripts/ext-package.mjs --no-build   # zip an already-built dist
 *
 * The ZIP writer is dependency-free (Node's built-in zlib DEFLATE + a hand
 * rolled local-file-header / central-directory writer), so it runs identically
 * on the Windows dev box and the Linux CI runner with no extra install.
 */
import { execFileSync } from "node:child_process";
import { deflateRawSync } from "node:zlib";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const distDir = path.join(repoRoot, "extension", "dist");

// ── Manifest validation (pure — exported for unit tests) ────────────────────

/**
 * Validates a parsed MV3 manifest against the Chrome Web Store's hard
 * requirements for this extension. Returns the list of problems (empty = OK)
 * so the caller can fail loudly. Pure: no I/O, no process exit — unit-tested.
 *
 * @param {unknown} manifest parsed manifest.json
 * @returns {string[]} human-readable problems; empty array means valid
 */
export function validateManifest(manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== "object") {
    return ["manifest is not an object"];
  }
  const m = /** @type {Record<string, unknown>} */ (manifest);

  if (m.manifest_version !== 3) {
    problems.push(`manifest_version must be 3 (got ${JSON.stringify(m.manifest_version)})`);
  }

  if (typeof m.name !== "string" || m.name.trim() === "") {
    problems.push("name is required and must be a non-empty string");
  } else if (!m.name.includes("TradeMarkk")) {
    problems.push(`name must contain the brand "TradeMarkk" (got ${JSON.stringify(m.name)})`);
  } else if (m.name.length > 75) {
    // Chrome Web Store hard cap on the extension name.
    problems.push(`name must be ≤ 75 chars (got ${m.name.length})`);
  }

  // version: 1-4 dot-separated integers, each 0..65535 (Chrome's rule).
  if (typeof m.version !== "string" || m.version.trim() === "") {
    problems.push("version is required and must be a string");
  } else {
    const parts = m.version.split(".");
    if (parts.length < 1 || parts.length > 4) {
      problems.push(`version must have 1-4 dot-separated parts (got ${JSON.stringify(m.version)})`);
    } else if (!parts.every((p) => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 65535)) {
      problems.push(`version parts must be integers 0-65535 (got ${JSON.stringify(m.version)})`);
    }
  }

  if (typeof m.description !== "string" || m.description.trim() === "") {
    problems.push("description is required and must be a non-empty string");
  } else if (m.description.length > 132) {
    // Web Store summary/description hard cap.
    problems.push(`description must be ≤ 132 chars (got ${m.description.length})`);
  }

  // Icons: the store requires a 128x128 icon.
  if (!m.icons || typeof m.icons !== "object") {
    problems.push("icons are required (need at least a 128px icon)");
  } else if (!(/** @type {Record<string, unknown>} */ (m.icons)["128"])) {
    problems.push("a 128px icon is required for the Web Store");
  }

  // MV3 background must be a service worker, not a background page.
  const bg = m.background;
  if (!bg || typeof bg !== "object") {
    problems.push("background.service_worker is required (MV3)");
  } else if (typeof (/** @type {Record<string, unknown>} */ (bg).service_worker) !== "string") {
    problems.push("background.service_worker must be a string path");
  }

  return problems;
}

/**
 * Reads + parses extension/dist/manifest.json, validates it, and throws with a
 * consolidated message if anything is wrong.
 * @param {string} manifestPath
 * @returns {{ version: string, name: string }}
 */
function readAndValidateManifest(manifestPath) {
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest.json missing at ${manifestPath} — run \`npm run ext:build\` first`);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    throw new Error(`manifest.json is not valid JSON: ${e instanceof Error ? e.message : e}`);
  }
  const problems = validateManifest(manifest);
  if (problems.length) {
    throw new Error(`Manifest validation failed:\n  - ${problems.join("\n  - ")}`);
  }
  return { version: manifest.version, name: manifest.name };
}

// ── Minimal dependency-free ZIP writer (DEFLATE, method 8) ──────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 over a buffer (PKZIP/zlib polynomial). */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Builds a ZIP archive in memory from a list of { name, data } entries.
 * Names use forward slashes (ZIP spec). DEFLATE-compresses each entry but
 * falls back to STORED when compression doesn't help, so the archive is always
 * valid and never larger than the raw bytes + headers.
 * @param {{ name: string, data: Buffer }[]} entries
 * @returns {Buffer}
 */
function buildZip(entries) {
  const localParts = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const compressed = deflateRawSync(data, { level: 9 });
    const useDeflate = compressed.length < data.length;
    const method = useDeflate ? 8 : 0;
    const stored = useDeflate ? compressed : data;

    // Local file header (signature 0x04034b50)
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 filenames
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date (1980-01-01-ish, deterministic)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    localParts.push(local, nameBuf, stored);

    // Central directory record (signature 0x02014b50)
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0x0800, 8); // flags: UTF-8
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12); // mod time
    cd.writeUInt16LE(0x21, 14); // mod date
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(stored.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra len
    cd.writeUInt16LE(0, 32); // comment len
    cd.writeUInt16LE(0, 34); // disk number
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42); // local header offset
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + stored.length;
  }

  const localBlock = Buffer.concat(localParts);
  const centralBlock = Buffer.concat(central);

  // End of central directory record (signature 0x06054b50)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // cd start disk
  eocd.writeUInt16LE(entries.length, 8); // entries this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(localBlock.length, 16); // cd offset
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([localBlock, centralBlock, eocd]);
}

/** Recursively lists files under `dir` as POSIX-relative paths from `dir`. */
function listFiles(dir, base = dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listFiles(full, base));
    } else {
      out.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
  return out;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const noBuild = process.argv.includes("--no-build");

  if (!noBuild) {
    console.log("[ext:package] building extension (ext:build)…");
    // Use the same npm script CI/dev use so the 7 build passes stay in sync.
    // `shell: true` is required so Windows can spawn npm.cmd (a batch file —
    // spawnSync EINVALs it otherwise); on Linux it's a plain `npm` shell call.
    execFileSync("npm", ["run", "ext:build"], { cwd: repoRoot, stdio: "inherit", shell: true });
  }

  const manifestPath = path.join(distDir, "manifest.json");
  const { version, name } = readAndValidateManifest(manifestPath);
  console.log(`[ext:package] manifest OK — "${name}" v${version}`);

  // Gather every built file at the dist root (manifest.json at archive top).
  // Exclude any previously-produced .zip so we never nest an old package.
  const files = listFiles(distDir).filter((f) => !f.endsWith(".zip"));
  if (!files.includes("manifest.json")) {
    throw new Error("manifest.json not found in dist file list — aborting");
  }

  const required = ["manifest.json", "sw.js"];
  for (const req of required) {
    if (!files.includes(req)) throw new Error(`required file ${req} missing from dist`);
  }

  const entries = files
    .sort() // deterministic archive ordering
    .map((rel) => ({ name: rel, data: readFileSync(path.join(distDir, rel)) }));

  const zipName = `trademarkk-extension-v${version}.zip`;
  const zipPath = path.join(distDir, zipName);
  if (existsSync(zipPath)) rmSync(zipPath);

  const zip = buildZip(entries);
  writeFileSync(zipPath, zip);

  const totalRaw = entries.reduce((n, e) => n + e.data.length, 0);
  console.log(
    `[ext:package] wrote ${zipName} — ${entries.length} files, ` +
      `${(totalRaw / 1024).toFixed(0)} kB raw -> ${(zip.length / 1024).toFixed(0)} kB zipped`
  );
  console.log(`[ext:package] artifact: ${zipPath}`);
  console.log(
    "[ext:package] cred-free package ready. Store submission needs the owner's " +
      "Chrome Web Store developer account (see extension/store-assets/store-listing.md)."
  );
}

// Only run when invoked directly (not when imported by the unit test).
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    main();
  } catch (e) {
    console.error(`[ext:package] FAILED: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
