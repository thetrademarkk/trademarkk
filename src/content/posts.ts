export interface Post {
  slug: string;
  title: string;
  description: string;
  date: string;
  body: string[]; // paragraphs
}

export const POSTS: Post[] = [
  {
    slug: "why-every-fno-trader-needs-a-journal",
    title: "Why every FnO trader needs a trading journal (and why most don't keep one)",
    description:
      "SEBI's own study found that 9 out of 10 FnO traders lose money. The ones who survive share one habit: they journal. Here's how to start.",
    date: "2026-06-01",
    body: [
      "SEBI's research on equity derivatives found that roughly 9 out of 10 individual FnO traders lose money, with average losses exceeding ₹1 lakh a year. The market doesn't change for anyone — but behaviour can. And behaviour only changes when it's measured.",
      "A trading journal is not a diary. It's a measurement system: what you planned, what you actually did, what it cost you. The gap between plan and execution is where most accounts bleed — revenge trades after a stop-loss, oversizing after a winning streak, chasing entries in the first five minutes.",
      "Start small. Log every trade with three facts: the setup, the stop, and the mistake (if any). Within 30 trades you will have data on yourself that no indicator can give you — your real win rate by time of day, the rupee cost of each bad habit, and which setups actually pay.",
      "TradeMark was built exactly for this loop: log in 15 seconds, tag the mistake, tick your rules daily, and review the week every Saturday. Free, open-source, and your data stays in your own database.",
    ],
  },
  {
    slug: "cost-of-breaking-your-trading-rules",
    title: "The ₹ cost of breaking your own trading rules — measured",
    description:
      "\"Max 3 trades a day\" is easy to write and hard to follow. Here's a framework to measure exactly what each broken rule costs you.",
    date: "2026-06-08",
    body: [
      "Every trader has rules. Almost no trader knows what breaking them costs. That number — the rupee cost per broken rule — is the single most motivating statistic in trading psychology.",
      "The framework is simple: every trading day, mark each of your rules as followed or broken. Then sum your losses on the days each rule was broken. After a month, sort the list. The rule at the top is your most expensive habit.",
      "Common results from intraday FnO traders: 'no trading after 2 consecutive losses' tops the list (revenge trading), followed by 'risk max 1% per trade' (oversizing) and 'no entries in the first 15 minutes' (gap chasing).",
      "TradeMark automates this entire loop with a daily rule checklist and an adherence dashboard that prices every broken rule. It takes 20 seconds a day, and the number it shows you is usually unforgettable.",
    ],
  },
];
