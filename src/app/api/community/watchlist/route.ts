import { NextResponse } from "next/server";
import { getSession, getWatchedSymbols } from "@/server/community";

/** The signed-in viewer's watched symbols (sorted). Empty for signed-out / on error. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ symbols: [] });
  const symbols = await getWatchedSymbols(session.user.id);
  return NextResponse.json({ symbols });
}
