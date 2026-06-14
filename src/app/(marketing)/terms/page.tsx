import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Use",
  description:
    "The terms governing your use of TradeMarkk — a journaling and education tool provided as is, not investment advice.",
  alternates: { canonical: "/terms" },
  // Match og:url to the route's canonical (relative — metadataBase resolves it)
  // so it doesn't inherit the homepage url; the branded card image still comes
  // from the root layout's explicit openGraph.images.
  openGraph: { url: "/terms" },
};

const SECTIONS = [
  {
    title: "Educational only",
    body: [
      "TradeMarkk is a journaling and education tool; nothing in it is investment, trading, tax or financial advice, and we are not a broker or adviser.",
    ],
  },
  {
    title: "Your data & responsibility",
    body: [
      "You are responsible for the accuracy of what you log; verify charges and figures against your broker's contract notes.",
    ],
  },
  {
    title: 'Provided "as is"',
    body: [
      "The software is provided as is, without warranties; to the extent permitted by law we are not liable for losses arising from its use or from trading decisions.",
    ],
  },
  {
    title: "Acceptable use",
    body: [
      "Don't misuse the service, attempt to break it, or use it unlawfully; community posts must follow the community guidelines (no tips or spam).",
    ],
  },
  {
    title: "Open source",
    body: ["The software is MIT-licensed; the licence governs the code."],
  },
  {
    title: "Changes",
    body: [
      'We may update these terms; the "Last updated" date above reflects the latest revision.',
    ],
  },
];

export default function TermsPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 md:py-14">
      <h1 className="text-3xl font-bold">Terms of Use</h1>
      <p className="mt-2 text-sm leading-6 text-muted">Last updated: June 14, 2026</p>
      <div className="mt-8 max-w-3xl space-y-6">
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
