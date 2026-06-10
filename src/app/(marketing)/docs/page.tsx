import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Docs — getting started",
  description: "How to set up TradeMark: hosted mode, bring-your-own Turso database, CSV imports and self-hosting.",
  alternates: { canonical: "/docs" },
};

export default function DocsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-14 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Getting started</h1>
        <p className="mt-2 text-sm text-muted">Three ways to run TradeMark — pick one, switch anytime.</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">1. Hosted (easiest)</h2>
        <p className="text-sm leading-6 text-muted">
          <Link href="/app/onboarding" className="text-accent underline">Sign up</Link> with email or
          Google. We provision a dedicated database for your journal — isolated from every other
          user. You can export everything or move to your own database at any time.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">2. Bring your own database (most private)</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-muted">
          <li>Create a free account at <a href="https://turso.tech" className="text-accent underline" target="_blank" rel="noreferrer">turso.tech</a></li>
          <li>Create a database: <code className="rounded bg-surface-2 px-1">turso db create my-journal</code></li>
          <li>Get the URL: <code className="rounded bg-surface-2 px-1">turso db show my-journal --url</code></li>
          <li>Create a token: <code className="rounded bg-surface-2 px-1">turso db tokens create my-journal</code></li>
          <li>Paste both in <Link href="/app/onboarding" className="text-accent underline">the connect wizard</Link></li>
        </ol>
        <p className="text-sm leading-6 text-muted">
          Credentials are stored only in your browser (optionally passphrase-encrypted). Every query
          goes directly from your browser to your database — we never see your data.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">3. Self-host</h2>
        <p className="text-sm leading-6 text-muted">
          Clone the repo, set the environment variables from <code className="rounded bg-surface-2 px-1">.env.example</code>{" "}
          (a Turso platform API token for hosted mode, Better Auth secret, optional Resend/Google
          keys) and deploy to Vercel. The README covers it step by step.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Importing your broker tradebook</h2>
        <p className="text-sm leading-6 text-muted">
          Trades → Import CSV. For Zerodha: Console → Reports → Tradebook → select the date range →
          download CSV → upload. Columns are auto-detected; buys/sells are paired into round trips
          with charges applied. Re-importing the same file never creates duplicates.
        </p>
      </section>
    </div>
  );
}
