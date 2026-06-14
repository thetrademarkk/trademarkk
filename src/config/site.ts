/** Serialize JSON-LD safely — prevents `</script>` breakout if content ever grows. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export const siteConfig = {
  name: "TradeMarkk",
  tagline: "Mark your trade, every day.",
  description:
    "Free, open-source trading journal for Indian traders — intraday, swing, positional, F&O, commodity (MCX) and currency. Paise-accurate Indian charges & tax pack, analytics, community, a multi-broker Chrome extension, and your data in your own database.",
  url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  github: "https://github.com/thetrademarkk/trademarkk",
  keywords: [
    "trading journal",
    "free trading journal",
    "open source trading journal",
    "FnO trading journal India",
    "intraday trading journal",
    "NIFTY options journal",
    "MCX commodity trading journal",
    "Indian trading tax report",
    "tradezella alternative free",
  ],
};

/**
 * Sitewide structured data shared across public routes. Returns an array of
 * JSON-LD nodes (Organization + WebSite) so search engines can surface the
 * brand, search action and social links. Pure — fully unit-testable.
 */
export function organizationJsonLd() {
  const url = siteConfig.url;
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${url}/#organization`,
    name: siteConfig.name,
    url,
    description: siteConfig.description,
    logo: `${url}/icon.svg`,
    sameAs: [siteConfig.github],
  } as const;
}

export function webSiteJsonLd() {
  const url = siteConfig.url;
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${url}/#website`,
    name: siteConfig.name,
    url,
    description: siteConfig.description,
    publisher: { "@id": `${url}/#organization` },
    inLanguage: "en-IN",
    // The site's real search surface: the community feed accepts a ?q= query.
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${url}/community?q={query}`,
      },
      "query-input": "required name=query",
    },
  } as const;
}
