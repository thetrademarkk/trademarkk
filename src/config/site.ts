/** Serialize JSON-LD safely — prevents `</script>` breakout if content ever grows. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export const siteConfig = {
  name: "TradeMark",
  tagline: "Mark your trade, every day.",
  description:
    "Free, open-source trading journal for Indian intraday & FnO traders. Track trades, mistakes and rules — your data stays in your own database.",
  url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  github: "https://github.com/raashish1601/trademark",
  keywords: [
    "trading journal",
    "free trading journal",
    "open source trading journal",
    "FnO trading journal India",
    "intraday trading journal",
    "NIFTY options journal",
    "tradezella alternative free",
  ],
};
