import type { Metadata } from "next";
import { QueryProvider } from "@/providers/query-provider";
import { DbSessionProvider } from "@/providers/db-session-provider";
import { AppShell } from "@/components/layout/app-shell";

// The journal is private — never indexed. SEO lives on the marketing surface.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "App",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <DbSessionProvider>
        <AppShell>{children}</AppShell>
      </DbSessionProvider>
    </QueryProvider>
  );
}
