// Pure helpers for deriving + injecting the service-worker cache VERSION.
// Kept dependency-free and side-effect-free so they are unit-testable; the
// filesystem-touching wrapper lives in gen-sw.mjs.

/** The placeholder literal that scripts/gen-sw.mjs replaces at build time. */
export const SW_VERSION_PLACEHOLDER = "__TM_SW_VERSION__";

/**
 * Derive a build-stable, deploy-unique service-worker version string from the
 * environment, falling back through Vercel SHA -> Next buildId -> git SHA ->
 * timestamp so the served bytes change on every deploy (PWA-03).
 *
 * @param {object} [opts]
 * @param {Record<string,string|undefined>} [opts.env] environment variables.
 * @param {string} [opts.buildId] Next.js .next/BUILD_ID contents.
 * @param {string} [opts.gitSha] short git commit SHA.
 * @param {() => number} [opts.now] clock (injectable for tests).
 * @returns {string} a cache key like "tm-<source>".
 */
export function deriveSwVersion(opts = {}) {
  const env = opts.env ?? {};
  const pick = (v) => (typeof v === "string" ? v.trim() : "");
  const vercel = pick(env.VERCEL_GIT_COMMIT_SHA);
  if (vercel) return `tm-${vercel.slice(0, 12)}`;
  const buildId = pick(opts.buildId);
  if (buildId) return `tm-${buildId}`;
  const gitSha = pick(opts.gitSha);
  if (gitSha) return `tm-${gitSha.slice(0, 12)}`;
  const now = (opts.now ?? Date.now)();
  return `tm-${now.toString(36)}`;
}

/**
 * Replace the VERSION placeholder (or a previously-injected version literal) in
 * the service-worker source with a concrete version. Idempotent: re-running with
 * a new version overwrites the prior one.
 *
 * @param {string} source service-worker file contents.
 * @param {string} version concrete version to inject.
 * @returns {string} updated source.
 */
export function injectSwVersion(source, version) {
  return source.replace(/const VERSION = "[^"]*";/, `const VERSION = "${version}";`);
}
