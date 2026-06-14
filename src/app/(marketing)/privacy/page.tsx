import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How TradeMarkk handles your data: your trading data is yours, we never sell it, and we show no ads.",
  alternates: { canonical: "/privacy" },
};

const SECTIONS = [
  {
    title: "Your journal data & where it lives",
    body: [
      "You choose the storage mode. Hosted — a dedicated, isolated database we manage for you. Bring your own database (BYOD) — your own Turso database; your credentials stay in your browser and your journal data never touches our servers. Local — everything stays in your browser.",
      "Hosted database copies are deleted 30 days after you switch away or delete your account.",
    ],
  },
  {
    title: "Account & authentication",
    body: [
      "If you create a hosted account we store your email, display name, and authentication credentials so we can sign you in. Passwords are stored only as salted hashes; we never see them in plain text.",
      "You can sign in with Google, in which case we store the Google account identifier and your email. You can delete your account and its database anytime from Settings.",
    ],
  },
  {
    title: "Email",
    body: [
      "We use a transactional email provider (Resend) solely to send account emails — email verification and password resets. We do not send marketing email.",
    ],
  },
  {
    title: "Analytics",
    body: [
      "We collect privacy-preserving, first-party analytics — aggregate page views and Core Web Vitals (load-performance metrics). These contain no fingerprinting and are never sold. We also use Vercel's aggregate analytics for performance.",
    ],
  },
  {
    title: "Community",
    body: [
      "If you choose to post in the community, your posts, profile, display name and anything you publish are public by design. Don't post anything you want to keep private.",
    ],
  },
  {
    title: "The browser extension",
    body: [
      "Its only purpose is to let you log trades and tick your daily trading-rules checklist from your broker's page. It reads a broker page (Zerodha Kite, Upstox, Groww, Dhan, Fyers) only while you are on it and only to read the trade details you choose to log.",
      "It stores your settings and your journal connection locally in your browser (chrome.storage). It sends trade data only to the TradeMarkk journal you connect it to — nowhere else.",
      "It does not track your browsing, show ads, or sell data. Its permissions are limited to what those functions require (side panel, local storage, reading the active broker tab when you invoke it, and scheduling rule reminders).",
    ],
  },
  {
    title: "What we don't do",
    body: [
      "We don't sell or rent your data, we don't show ads, and we don't use your trading data for advertising, lending, or creditworthiness decisions.",
    ],
  },
  {
    title: "Your control",
    body: [
      "Export or delete your data anytime from in-app Settings. Deleting a hosted account permanently removes its database.",
    ],
  },
  {
    title: "Open source",
    body: [
      "TradeMarkk is MIT-licensed and fully auditable at github.com/thetrademarkk/trademarkk — you can verify these claims in the source.",
    ],
  },
  {
    title: "Contact",
    body: [
      "Questions about privacy? Reach us via the in-app Feedback button or by opening an issue at github.com/thetrademarkk/trademarkk.",
    ],
  },
  {
    title: "Changes",
    body: [
      'We may update this policy; the "Last updated" date above reflects the latest revision.',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 md:py-14">
      <h1 className="text-3xl font-bold">Privacy Policy</h1>
      <p className="mt-2 text-sm leading-6 text-muted">Last updated: June 14, 2026</p>
      <div className="mt-8 max-w-3xl space-y-6">
        <p className="text-sm leading-6 text-muted">
          TradeMarkk is a free, open-source trading journal — a web app at thetrademarkk.com and an
          optional browser extension. This policy explains what data each one handles. The short
          version: your trading data is yours, we never sell it, and we show no ads.
        </p>
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="text-base font-semibold">{s.title}</h2>
            {s.body.map((p, i) => (
              <p key={i} className="mt-1 text-sm leading-6 text-muted">
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
