export interface PostSection {
  id: string;
  heading: string;
  paragraphs: string[];
}

export interface Post {
  slug: string;
  title: string;
  description: string;
  date: string;
  intro: string;
  sections: PostSection[];
}

export function readingTime(post: Post): number {
  const words = [post.intro, ...post.sections.flatMap((s) => [s.heading, ...s.paragraphs])]
    .join(" ")
    .split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
}

export const POSTS: Post[] = [
  {
    slug: "why-every-fno-trader-needs-a-journal",
    title: "Why every FnO trader needs a trading journal (and why most don't keep one)",
    description:
      "SEBI's own study found that 9 out of 10 FnO traders lose money. The ones who survive share one habit: they journal. Here's how to start.",
    date: "2026-06-01",
    intro:
      "SEBI's research on equity derivatives found that roughly 9 out of 10 individual FnO traders lose money, with average losses exceeding ₹1 lakh a year. The market doesn't change for anyone — but behaviour can. And behaviour only changes when it's measured.",
    sections: [
      {
        id: "journal-is-not-a-diary",
        heading: "A journal is not a diary",
        paragraphs: [
          "A trading journal is a measurement system, not a feelings log: what you planned, what you actually did, and what the gap cost you. That gap between plan and execution is where most accounts bleed — revenge trades after a stop-loss, oversizing after a winning streak, chasing entries in the first five minutes of the open.",
          "Professional desks force this discipline on traders with risk reports and reviews. Retail traders have to force it on themselves — which is exactly why so few do it, and why the few who do have a real edge.",
        ],
      },
      {
        id: "what-to-record",
        heading: "What to record (it's less than you think)",
        paragraphs: [
          "Start with three facts per trade: the setup you traded, the stop you planned, and the mistake you made (if any). That's it. Logging should take 15 seconds, because a journal you don't keep is worth exactly nothing.",
          "Within 30 trades you will have data on yourself that no indicator can give you — your real win rate by time of day, the rupee cost of each bad habit, and which setups actually pay you versus the ones you just enjoy trading.",
        ],
      },
      {
        id: "the-weekly-review",
        heading: "The weekly review is where the money is",
        paragraphs: [
          "Logging is collection; reviewing is compounding. Every Saturday, open the week: net P&L after charges, rule adherence, the most expensive mistake. Pick one behaviour to fix next week. One.",
          "Traders who review weekly stop repeating their worst trade. Traders who don't, repeat it with size.",
        ],
      },
      {
        id: "start-today",
        heading: "Start today, free",
        paragraphs: [
          "TradeMark was built exactly for this loop: log in 15 seconds, tag the mistake, tick your rules daily, and review the week every Saturday. It's free, open-source, and your data can live in your own database.",
        ],
      },
    ],
  },
  {
    slug: "cost-of-breaking-your-trading-rules",
    title: "The ₹ cost of breaking your own trading rules — measured",
    description:
      '"Max 3 trades a day" is easy to write and hard to follow. Here\'s a framework to measure exactly what each broken rule costs you.',
    date: "2026-06-08",
    intro:
      "Every trader has rules. Almost no trader knows what breaking them costs. That number — the rupee cost per broken rule — is the single most motivating statistic in trading psychology.",
    sections: [
      {
        id: "the-framework",
        heading: "The framework",
        paragraphs: [
          "The mechanics are simple. Every trading day, mark each of your rules as followed or broken — it takes 20 seconds. Then total your losses on the days each rule was broken. After a month, sort the list descending.",
          "The rule at the top is your most expensive habit. Not the one you feel worst about — the one that actually costs the most. They're rarely the same rule.",
        ],
      },
      {
        id: "what-traders-find",
        heading: "What traders usually find",
        paragraphs: [
          "Common results from intraday FnO traders: 'stop after 2 consecutive losses' tops the list (revenge trading), followed by 'risk max 1% per trade' (oversizing after wins) and 'no entries in the first 15 minutes' (gap chasing).",
          "The pattern is consistent: the expensive rules are the emotional ones, not the technical ones. Nobody loses lakhs because their moving average period was wrong.",
        ],
      },
      {
        id: "why-the-number-works",
        heading: "Why seeing the number works",
        paragraphs: [
          "Vague guilt ('I overtraded again') doesn't change behaviour. A number does: '₹18,400 lost this month on days I revenge-traded' is unforgettable. It converts discipline from a virtue into a P&L line item — and traders are very good at optimizing P&L line items.",
          "TradeMark automates this entire loop with a daily rule checklist and an adherence dashboard that prices every broken rule. Twenty seconds a day, and the number it shows you is usually the one that finally changes the habit.",
        ],
      },
    ],
  },
];
