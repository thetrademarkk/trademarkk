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
  emailFrom: process.env.EMAIL_FROM ?? "TradeMark <onboarding@resend.dev>",
  upstashUrl: process.env.UPSTASH_REDIS_REST_URL ?? "",
  upstashToken: process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
};

export const hasTursoApi = () => Boolean(serverEnv.tursoApiToken && serverEnv.tursoOrg);
export const hasResend = () => Boolean(serverEnv.resendApiKey);
