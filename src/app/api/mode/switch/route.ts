import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/server/auth";
import { platformDb } from "@/server/db/platform";
import { userDatabases } from "@/server/db/platform-schema";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";

const bodySchema = z.object({ mode: z.enum(["hosted", "byod"]) });

/**
 * Records a storage-mode flip AFTER the client-side migration has copied and
 * verified the data. Switching to BYOD starts a 30-day grace period on the
 * hosted DB; switching back clears it.
 */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { allowed } = await rateLimit(`mode-switch:${session.user.id}`, 10, 3600);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { mode } = parsed.data;

  const row = await platformDb
    .select()
    .from(userDatabases)
    .where(eq(userDatabases.userId, session.user.id))
    .get();
  if (!row) {
    return NextResponse.json(
      { error: "No hosted database on record. Provision first." },
      { status: 409 }
    );
  }

  const graceUntil = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  await platformDb
    .update(userDatabases)
    .set(
      mode === "byod"
        ? { storageMode: "byod", status: "grace", deleteAfter: graceUntil }
        : { storageMode: "hosted", status: "active", deleteAfter: null }
    )
    .where(eq(userDatabases.userId, session.user.id));

  return NextResponse.json({ storageMode: mode, deleteAfter: mode === "byod" ? graceUntil : null });
}
