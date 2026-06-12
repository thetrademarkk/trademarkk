import "server-only";
import { serverEnv } from "./env";

/**
 * CSRF defense-in-depth for state-changing routes. Better Auth cookies are
 * SameSite=Lax (already blocks cross-site POSTs); this additionally rejects
 * requests whose Origin doesn't match the deployment — or the one pinned
 * companion-extension ID (websites cannot forge a chrome-extension:// Origin).
 */
export function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients / same-origin GET
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
