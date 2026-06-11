import { NextResponse } from "next/server";
import { z } from "zod";
import { newId } from "@/lib/id";
import { platformDb } from "@/server/db/platform";
import { feedback } from "@/server/db/platform-schema";
import { getSession } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";

const feedbackSchema = z.object({
  category: z.enum(["bug", "idea", "other"]),
  message: z.string().min(5, "Tell us a little more").max(2000),
  email: z.string().email().optional().or(z.literal("")),
  path: z.string().max(200).optional(),
  anonymous: z.boolean().optional(),
});

/** Anonymous-friendly feedback — signed-in users are linked automatically. */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await getSession();

  const key = session?.user.id ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "anon";
  const { allowed } = await rateLimit(`feedback:${key}`, 5, 3600);
  if (!allowed) return NextResponse.json({ error: "Too many submissions — try later" }, { status: 429 });

  const parsed = feedbackSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid feedback" },
      { status: 400 }
    );
  }

  // Anonymous submissions strip ALL identity, even for signed-in users.
  const anonymous = parsed.data.anonymous === true;
  await platformDb.insert(feedback).values({
    id: newId(),
    userId: anonymous ? null : (session?.user.id ?? null),
    email: anonymous ? null : parsed.data.email || session?.user.email || null,
    category: parsed.data.category,
    message: parsed.data.message.trim(),
    path: parsed.data.path ?? null,
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ received: true }, { status: 201 });
}
