import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import NextTopLoader from "nextjs-toploader";
import { ThemeProvider } from "@/providers/theme-provider";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { PwaRegister } from "@/components/pwa-register";
import { AnalyticsTracker } from "@/components/analytics-tracker";
import { siteConfig } from "@/config/site";
import "@/styles/globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: `${siteConfig.name} — Free open-source trading journal for Indian FnO traders`,
    template: `%s · ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [...siteConfig.keywords],
  applicationName: siteConfig.name,
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
    url: siteConfig.url,
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0A0A0B" },
    { media: "(prefers-color-scheme: light)", color: "#FAFAFA" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply color-blind-safe P&L palette before paint (no flash). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('tm.pl-cb')==='1')document.documentElement.dataset.pl='cb'}catch(e){}`,
          }}
        />
      </head>
      <body className={`${sans.variable} ${mono.variable} font-sans antialiased`}>
        <ThemeProvider>
          {/* YouTube-style route-change progress bar — every surface. */}
          <NextTopLoader
            color="var(--accent)"
            height={3}
            showSpinner={false}
            shadow="0 0 8px var(--accent)"
          />
          <PwaRegister />
          <AnalyticsTracker />
          {/* Vercel-side visitor + web-vitals collection. Render only on Vercel:
              the scripts live at /_vercel/* which 404s (console errors) on
              local production builds. */}
          {process.env.VERCEL === "1" && (
            <>
              <Analytics />
              <SpeedInsights />
            </>
          )}
          <ConfirmProvider>{children}</ConfirmProvider>
          <Toaster
            position="top-center"
            toastOptions={{
              style: {
                background: "var(--surface-2)",
                color: "var(--text)",
                border: "1px solid var(--border)",
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
