import { describe, expect, it } from "vitest";
import { jsonLdScript, organizationJsonLd, siteConfig, webSiteJsonLd } from "./site";

describe("jsonLdScript", () => {
  it("escapes < so a nested </script> can never break out of the tag", () => {
    const out = jsonLdScript({ name: "</script><script>alert(1)" });
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c/script");
  });

  it("round-trips to valid JSON after unescaping", () => {
    const data = { a: 1, b: "x<y" };
    const parsed = JSON.parse(jsonLdScript(data).replace(/\\u003c/g, "<"));
    expect(parsed).toEqual(data);
  });
});

describe("organizationJsonLd", () => {
  const org = organizationJsonLd();

  it("is a well-formed schema.org Organization node", () => {
    expect(org["@context"]).toBe("https://schema.org");
    expect(org["@type"]).toBe("Organization");
    expect(org.name).toBe(siteConfig.name);
    expect(org.url).toBe(siteConfig.url);
  });

  it("derives logo and id from the canonical site url", () => {
    expect(org["@id"]).toBe(`${siteConfig.url}/#organization`);
    expect(org.logo).toBe(`${siteConfig.url}/icon.svg`);
  });

  it("links the GitHub repo via sameAs", () => {
    expect(org.sameAs).toContain(siteConfig.github);
  });
});

describe("webSiteJsonLd", () => {
  const site = webSiteJsonLd();

  it("is a well-formed schema.org WebSite node", () => {
    expect(site["@context"]).toBe("https://schema.org");
    expect(site["@type"]).toBe("WebSite");
    expect(site.url).toBe(siteConfig.url);
    expect(site.inLanguage).toBe("en-IN");
  });

  it("points its publisher at the Organization node by id", () => {
    expect(site.publisher["@id"]).toBe(`${siteConfig.url}/#organization`);
    expect(site.publisher["@id"]).toBe(organizationJsonLd()["@id"]);
  });

  it("emits a SearchAction whose target points at the community ?q= search", () => {
    const action = site.potentialAction;
    expect(action["@type"]).toBe("SearchAction");
    expect(action.target.urlTemplate).toBe(`${siteConfig.url}/community?q={query}`);
    expect(action["query-input"]).toBe("required name=query");
  });
});

describe("siteConfig", () => {
  it("uses the TradeMarkk brand and the canonical GitHub repo", () => {
    expect(siteConfig.name).toBe("TradeMarkk");
    expect(siteConfig.github).toContain("thetrademarkk");
  });

  it("carries no empty keywords", () => {
    expect(siteConfig.keywords.length).toBeGreaterThan(0);
    for (const k of siteConfig.keywords) expect(k.trim().length).toBeGreaterThan(0);
  });
});
