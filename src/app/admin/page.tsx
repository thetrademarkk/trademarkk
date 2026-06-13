import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { auth } from "@/server/auth";
import { isAdmin } from "@/server/blog";
import { Logo } from "@/components/shared/logo";
import { QueryProvider } from "@/providers/query-provider";
import { AdminShell } from "./admin-shell";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

export default async function AdminPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/app/onboarding");
  if (!isAdmin(session.user.email)) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-lg font-semibold">Not authorized</h1>
        <p className="text-sm text-muted">This area is restricted to administrators.</p>
        <Link href="/" className="mt-2 text-sm text-accent hover:underline">
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
          <Logo />
          <span className="flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Admin
          </span>
          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-1 text-xs text-muted hover:text-foreground"
            >
              View site <ExternalLink className="h-3 w-3" aria-hidden />
            </Link>
            <span className="hidden text-xs text-muted sm:inline">{session.user.email}</span>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <QueryProvider>
          <AdminShell />
        </QueryProvider>
      </main>
    </div>
  );
}
