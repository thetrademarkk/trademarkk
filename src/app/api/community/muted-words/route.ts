import { NextResponse } from "next/server";
import { z } from "zod";
import { addMutedWord, getMutedWords, getSession, removeMutedWord } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import { MAX_TERM_LENGTH, sanitizeMuteEntry } from "@/features/community/muted-words";

/**
 * Personal "muted words" content filter for the signed-in user.
 *
 * GET    → the user's mute entries (term + mode + flags).
 * POST   → add one entry: `{ term, mode, caseSensitive?, scope?, durationMs? }`.
 * DELETE → remove one entry: `{ term, mode }`.
 *
 * Strictly PERSONAL — these hide matching posts/comments from THIS user's own
 * feeds/threads only; never moderation, never affects others. Additive +
 * backward-compatible: a user who has never touched this stores no column and
 * sees everything (the default).
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ entries: [] });
  const entries = await getMutedWords(session.user.id, session.user.name);
  return NextResponse.json({ entries });
}

const addSchema = z.object({
  term: z
    .string()
    .min(1)
    .max(MAX_TERM_LENGTH + 1), // sanitizer trims/strips sigils
  mode: z.enum(["substring", "word", "cashtag", "hashtag"]),
  caseSensitive: z.boolean().optional(),
  scope: z.enum(["feed", "everywhere"]).optional(),
  /** Mute duration in ms from now; 0/absent = forever. Capped to a sane ceiling. */
  durationMs: z
    .number()
    .int()
    .min(0)
    .max(366 * 24 * 60 * 60 * 1000)
    .optional(),
});

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { allowed } = await rateLimit(`muted-words:${session.user.id}`, 60, 3600);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid mute" },
      { status: 400 }
    );
  }
  const { term, mode, caseSensitive, scope, durationMs } = parsed.data;
  const expiresAt =
    durationMs && durationMs > 0 ? new Date(Date.now() + durationMs).toISOString() : null;

  // Sanitize/normalize through the pure helper so the server never trusts the
  // raw term (strips $/# sigils, normalizes case, rejects empty after trim).
  const entry = sanitizeMuteEntry({
    term,
    mode,
    caseSensitive,
    scope,
    expiresAt,
    createdAt: new Date().toISOString(),
  });
  if (!entry) {
    return NextResponse.json({ error: "That word can't be muted" }, { status: 400 });
  }

  const entries = await addMutedWord(session.user.id, session.user.name, entry);
  return NextResponse.json({ entries });
}

const removeSchema = z.object({
  term: z
    .string()
    .min(1)
    .max(MAX_TERM_LENGTH + 2),
  mode: z.enum(["substring", "word", "cashtag", "hashtag"]),
});

export async function DELETE(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { allowed } = await rateLimit(`muted-words:${session.user.id}`, 60, 3600);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = removeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const entries = await removeMutedWord(
    session.user.id,
    session.user.name,
    parsed.data.mode,
    parsed.data.term
  );
  return NextResponse.json({ entries });
}
