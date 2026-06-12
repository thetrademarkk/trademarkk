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
      {/* Pre-hydration onboarding redirect: no stored mode means AppShell will
          router.replace("/app/onboarding") anyway — but only after the whole
          app bundle hydrates (~seconds on mobile). Doing it at parse time
          skips that dead download and paints onboarding (static HTML) almost
          immediately. AppShell keeps the effect for SPA navigations. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `try{if(location.pathname.indexOf('/app/onboarding')!==0&&!localStorage.getItem('tm.mode'))location.replace('/app/onboarding')}catch(e){}`,
        }}
      />
      <DbSessionProvider>
        <AppShell>{children}</AppShell>
      </DbSessionProvider>
    </QueryProvider>
  );
}
