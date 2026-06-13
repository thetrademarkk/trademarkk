import { NextResponse } from "next/server";
import { z } from "zod";
import { getNotificationPrefs, getSession, setNotificationPref } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import {
  isPrefNotificationType,
  resolvePrefToggles,
} from "@/features/community/notification-prefs";

/**
 * Per-type in-app notification preferences for the signed-in user.
 *
 * GET  → the full toggle list (every type + label/description + on/off state).
 * PUT  → toggle ONE type: `{ type: "follow", enabled: false }`.
 *
 * Additive + backward-compatible: a user who has never touched this stores no
 * column and every type stays ON; `notify()` consults the same prefs at emit.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const prefs = await getNotificationPrefs(session.user.id, session.user.name);
  return NextResponse.json({ toggles: resolvePrefToggles(prefs) });
}

const updateSchema = z.object({
  type: z.string().min(1).max(40),
  enabled: z.boolean(),
});

export async function PUT(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { allowed } = await rateLimit(`notif-prefs:${session.user.id}`, 60, 3600);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid preference" }, { status: 400 });
  }
  // Only known, user-controllable types are writable — never let an arbitrary
  // string land in the stored map (and bypass types can't be disabled at all).
  if (!isPrefNotificationType(parsed.data.type)) {
    return NextResponse.json({ error: "Unknown notification type" }, { status: 400 });
  }

  const next = await setNotificationPref(
    session.user.id,
    session.user.name,
    parsed.data.type,
    parsed.data.enabled
  );
  return NextResponse.json({ toggles: resolvePrefToggles(next) });
}
