import type { Metadata } from "next";
import Link from "next/link";
import { Toc } from "../blog/_components/toc";

export const metadata: Metadata = {
  title: "Docs — getting started",
  description:
    "How to set up TradeMarkk: hosted mode, bring-your-own Turso database, CSV imports, mode switching, community and self-hosting.",
  alternates: { canonical: "/docs" },
};

const code = "rounded bg-surface-2 px-1";

const SECTIONS: { id: string; heading: string; body: React.ReactNode }[] = [
  {
    id: "hosted",
    heading: "1 · Hosted (easiest)",
    body: (
      <p>
        <Link href="/app/onboarding" className="text-accent underline">
          Sign up
        </Link>{" "}
        with email or Google. We provision a dedicated database for your journal — isolated from
        every other user. You can export everything or move to your own database at any time.
      </p>
    ),
  },
  {
    id: "byod",
    heading: "2 · Bring your own database",
    body: (
      <>
        <p>No terminal needed — everything works from Turso&apos;s web dashboard:</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Create a free account at{" "}
            <a
              href="https://app.turso.tech"
              className="text-accent underline"
              target="_blank"
              rel="noreferrer"
            >
              app.turso.tech
            </a>{" "}
            (no card needed)
          </li>
          <li>
            Click <strong>Databases → Create Database</strong>, give it a name (e.g.{" "}
            <code className={code}>my-journal</code>)
          </li>
          <li>
            Open the database and copy its <strong>URL</strong> (starts with{" "}
            <code className={code}>libsql://</code>)
          </li>
          <li>
            Click <strong>Generate Token</strong> (read &amp; write) and copy it
          </li>
          <li>
            Paste both in{" "}
            <Link href="/app/onboarding" className="text-accent underline">
              the connect wizard
            </Link>
          </li>
        </ol>
        <p>
          CLI fans: <code className={code}>turso db create my-journal</code>, then{" "}
          <code className={code}>turso db show my-journal --url</code> and{" "}
          <code className={code}>turso db tokens create my-journal</code>.
        </p>
        <p>
          Credentials are stored only in your browser (optionally passphrase-encrypted). Every query
          goes directly from your browser to your database — we never see your data.
        </p>
      </>
    ),
  },
  {
    id: "import",
    heading: "3 · Import your broker tradebook",
    body: (
      <p>
        Trades → Import CSV. For Zerodha: Console → Reports → Tradebook → select the date range →
        download CSV → upload. Columns are auto-detected; buys/sells are paired into round trips
        with charges applied. Re-importing the same file never creates duplicates.
      </p>
    ),
  },
  {
    id: "switching",
    heading: "4 · Switching storage modes",
    body: (
      <p>
        Settings → <strong>Switch storage mode</strong>. Your data is copied directly from your
        browser to the target (hosted ⇄ your DB ⇄ this browser), verified table-by-table, and only
        then switched. Leaving hosted starts a 30-day grace period before the hosted copy is
        deleted; your own database is never touched by us.
      </p>
    ),
  },
  {
    id: "community",
    heading: "5 · Community & sharing trades",
    body: (
      <p>
        The{" "}
        <Link href="/community" className="text-accent underline">
          community
        </Link>{" "}
        uses a free TradeMarkk account as your public identity — your journal stays wherever you
        keep it. Share any trade from its detail page as a structured trade card; your ₹ P&amp;L is
        only included if you toggle it on.
      </p>
    ),
  },
  {
    id: "blog",
    heading: "6 · Writing for the blog",
    body: (
      <p>
        Anyone can{" "}
        <Link href="/blog/write" className="text-accent underline">
          submit an article
        </Link>{" "}
        with the rich-text editor. Submissions are reviewed before publishing — educational,
        original content only.
      </p>
    ),
  },
  {
    id: "self-host",
    heading: "7 · Self-host",
    body: (
      <p>
        Clone the repo, set the environment variables from{" "}
        <code className={code}>.env.example</code> (a Turso platform API token for hosted mode,
        Better Auth secret, optional Resend/Google keys, <code className={code}>ADMIN_EMAILS</code>{" "}
        for the admin panel) and deploy to Vercel. The README covers it step by step.
      </p>
    ),
  },
];

export default function DocsPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 md:py-14">
      <div className="grid gap-10 lg:grid-cols-[210px_minmax(0,1fr)]">
        {/* ── Left rail (MDN-style) ── */}
        <aside className="hidden lg:block">
          <div className="sticky top-20">
            <Toc items={SECTIONS.map((s) => ({ id: s.id, heading: s.heading }))} />
          </div>
        </aside>

        <div className="min-w-0 max-w-3xl">
          <h1 className="text-3xl font-bold">Documentation</h1>
          <p className="mt-2 text-sm text-muted">
            Everything you need to run TradeMarkk — pick a storage mode, import your trades, switch
            anytime.
          </p>

          {/* Mobile nav */}
          <details className="mt-6 rounded-lg border bg-surface px-4 py-3 lg:hidden">
            <summary className="text-sm font-medium">On this page</summary>
            <ul className="mt-2 space-y-1.5">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-sm text-muted hover:text-accent">
                    {s.heading}
                  </a>
                </li>
              ))}
            </ul>
          </details>

          <div className="mt-8 space-y-10">
            {SECTIONS.map((s) => (
              <section key={s.id}>
                <h2 id={s.id} className="scroll-mt-24 text-lg font-semibold">
                  <a href={`#${s.id}`} className="hover:text-accent">
                    {s.heading}
                  </a>
                </h2>
                <div className="mt-2 space-y-3 text-sm leading-6 text-muted">{s.body}</div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
