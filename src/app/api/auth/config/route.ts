import { NextResponse } from "next/server";
import { hasGoogle } from "@/server/env";

/**
 * Tiny public surface telling the client which auth options are actually wired.
 * Currently just whether "Continue with Google" should render — true ONLY when
 * the server has BOTH Google OAuth credentials (hasGoogle()). The button reads
 * this rather than a NEXT_PUBLIC_ flag so it can NEVER appear without a working
 * provider behind it: the gate and the registration share one source of truth.
 * No secrets are exposed — only the boolean.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ google: hasGoogle() });
}
