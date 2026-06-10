import "server-only";
import { serverEnv } from "./env";

/**
 * CSRF defense-in-depth for state-changing routes. Better Auth cookies are
 * SameSite=Lax (already blocks cross-site POSTs); this additionally rejects
 * requests whose Origin doesn't match the deployment.
 */
export function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients / same-origin GET
  try {
    return new URL(origin).origin === new URL(serverEnv.authUrl).origin;
  } catch {
    return false;
  }
}
