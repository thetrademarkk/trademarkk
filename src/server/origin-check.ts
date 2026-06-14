import "server-only";
import { serverEnv } from "./env";

/**
 * CSRF defense-in-depth for state-changing routes. Better Auth cookies are
 * SameSite=Lax (already blocks cross-site POSTs); this additionally rejects
 * requests whose Origin doesn't match the deployment — or the one pinned
 * companion-extension ID (websites cannot forge a chrome-extension:// Origin).
 *
 * When the Origin header is absent we fall back to the Fetch Metadata
 * Sec-Fetch-Site header (if the browser sent one) before defaulting to allow,
 * so an Origin-stripped cross-site POST is still rejected. See the body for the
 * exact fallback rules.
 */
export function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) {
    // No Origin header. Modern browsers still send Sec-Fetch-Site on every
    // request, so consult it as a second signal before falling back to the
    // permissive default:
    //   - "same-origin"/"none" (address-bar nav, same-site fetch) → allow
    //   - "cross-site"/"same-site" with no matching Origin → a forged/stripped
    //     cross-origin POST; reject (real same-origin browser POSTs carry Origin)
    // Non-browser clients (curl, the repo's e2e fetch scripts) send neither
    // header, so when both are absent we keep allowing — SameSite=Lax cookies
    // are then the sole CSRF control, which is acceptable defense-in-depth here.
    const secFetchSite = req.headers.get("sec-fetch-site");
    if (secFetchSite) return secFetchSite === "same-origin" || secFetchSite === "none";
    return true; // non-browser clients / same-origin GET — SameSite=Lax is the CSRF control
  }
  // chrome-extension:// is not a WHATWG "special scheme", so new URL(...).origin
  // would collapse it to "null" — compare the raw header (it's already a bare
  // origin) against the single pinned extension ID instead.
  if (origin.startsWith("chrome-extension://")) {
    return Boolean(serverEnv.extensionOrigin) && origin === serverEnv.extensionOrigin;
  }
  try {
    return new URL(origin).origin === new URL(serverEnv.authUrl).origin;
  } catch {
    return false;
  }
}
