import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { rateLimit } from "@/server/rate-limit";

const handler = toNextJsHandler(auth.handler);

export const GET = handler.GET;

/**
 * Durable per-IP brake on the abuse-prone auth endpoints, applied BEFORE
 * delegating to Better Auth. Keyed on IP + path only — the body is never read
 * or cloned (Better Auth must consume the original stream).
 *
 * The look-normal responses on forget-password / sign-up are intentional
 * anti-enumeration: a blocked attacker gets the same 200 a real request would.
 */
export async function POST(req: Request): Promise<Response> {
  const ip = (req.headers.get("x-forwarded-for") ?? "anon").split(",")[0]?.trim() || "anon";
  const path = new URL(req.url).pathname;

  // Password-reset request: 10 / hour / IP → blocked looks like success (no
  // leak). Better Auth exposes this as both /forget-password and
  // /request-password-reset; both share the same fp:ip counter.
  if (path.endsWith("/forget-password") || path.endsWith("/request-password-reset")) {
    const { allowed } = await rateLimit(`fp:ip:${ip}`, 10, 3600);
    if (!allowed) return NextResponse.json({ status: true });
  }
  // sign-up (email): 3 / hour / IP → blocked looks like success.
  else if (path.endsWith("/sign-up/email")) {
    const { allowed } = await rateLimit(`su:ip:${ip}`, 3, 3600);
    if (!allowed) return NextResponse.json({ status: true });
  }
  // sign-in (email): 20 / hour / IP → blocked returns an explicit 429.
  else if (path.endsWith("/sign-in/email")) {
    const { allowed } = await rateLimit(`si:ip:${ip}`, 20, 3600);
    if (!allowed) return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }
  // OTP issue (verification/sign-in code): 10 / hour / IP → blocked looks like
  // success (no leak about whether the email exists). Durable per-account caps
  // + the emailOTP plugin's own limiter sit behind this.
  else if (
    path.endsWith("/email-otp/send-verification-otp") ||
    path.endsWith("/sign-in/email-otp")
  ) {
    const { allowed } = await rateLimit(`otp:ip:${ip}`, 10, 3600);
    if (!allowed) return NextResponse.json({ success: true });
  }
  // OTP verify: 20 / hour / IP → blocked returns an explicit 429 (a real user
  // mistyping a few times stays well under this; brute-forcing a 6-digit code is
  // already gated by the plugin's 5-attempt limit per issued code).
  else if (path.endsWith("/email-otp/verify-email")) {
    const { allowed } = await rateLimit(`otpv:ip:${ip}`, 20, 3600);
    if (!allowed) return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  return handler.POST(req);
}
