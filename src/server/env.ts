import "server-only";

/** Server-only environment access. The platform API token must NEVER reach the client. */
export const serverEnv = {
  platformDbUrl: process.env.TURSO_PLATFORM_DB_URL ?? "",
  platformDbToken: process.env.TURSO_PLATFORM_DB_TOKEN ?? "",
  tursoApiToken: process.env.TURSO_PLATFORM_API_TOKEN ?? "",
  tursoOrg: process.env.TURSO_ORG_SLUG ?? "",
  tursoGroup: process.env.TURSO_GROUP ?? "default",
  authSecret: process.env.BETTER_AUTH_SECRET ?? "",
  authUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "TradeMarkk <onboarding@resend.dev>",
  upstashUrl: process.env.UPSTASH_REDIS_REST_URL ?? "",
  upstashToken: process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
  adminEmails: process.env.ADMIN_EMAILS ?? "",
  /**
   * When set (to any truthy value), the events surface accepts a `?date=`
   * YYYY-MM-DD override so e2e can deterministically simulate a trading /
   * expiry / holiday day without touching the real clock. NEVER set in
   * production — the override is ignored unless this flag is present.
   */
  allowEventsDateOverride: process.env.EVENTS_TEST_DATE_OVERRIDE === "1",
  /**
   * Origin of the official companion extension — pinned to one extension ID
   * via the manifest "key" (never a wildcard). The ID is public information;
   * every request from it still needs a session and obeys rate limits.
   * Forks/self-hosters override with their own ID; set "" to disable.
   */
  extensionOrigin:
    process.env.EXTENSION_ORIGIN ?? "chrome-extension://ibfnimbkdoiafemjonbnnjhnojodanej",
};

export const hasTursoApi = () => Boolean(serverEnv.tursoApiToken && serverEnv.tursoOrg);
export const hasResend = () => Boolean(serverEnv.resendApiKey);
