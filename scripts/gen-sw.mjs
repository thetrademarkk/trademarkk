// Injects a build-derived VERSION into public/sw.js so every deploy ships a
// byte-different service worker (PWA-03). Runs as `postbuild` (after next build
// has written .next/BUILD_ID). Vercel sets VERCEL_GIT_COMMIT_SHA; locally we
// fall back to the Next buildId, then the git SHA, then a timestamp.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveSwVersion, injectSwVersion } from "./sw-version.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const swPath = join(root, "public", "sw.js");

function readBuildId() {
  const distDir = process.env.NEXT_DIST_DIR || ".next";
  const idPath = join(root, distDir, "BUILD_ID");
  try {
    return existsSync(idPath) ? readFileSync(idPath, "utf8").trim() : "";
  } catch {
    return "";
  }
}

function readGitSha() {
  try {
    return execSync("git rev-parse --short=12 HEAD", {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

const version = deriveSwVersion({
  env: process.env,
  buildId: readBuildId(),
  gitSha: readGitSha(),
});

const source = readFileSync(swPath, "utf8");
const updated = injectSwVersion(source, version);
writeFileSync(swPath, updated);
console.log(`[gen-sw] public/sw.js VERSION -> ${version}`);
