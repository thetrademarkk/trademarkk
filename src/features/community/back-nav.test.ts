import { describe, expect, it } from "vitest";
import { communityBackHref } from "./back-nav";

describe("communityBackHref", () => {
  it("returns the plain feed when nothing is stored", () => {
    expect(communityBackHref(null)).toBe("/community");
    expect(communityBackHref(undefined)).toBe("/community");
    expect(communityBackHref("")).toBe("/community");
  });

  it("preserves a tag filter", () => {
    expect(communityBackHref("?tag=banknifty")).toBe("/community?tag=banknifty");
    expect(communityBackHref("?tag=price%20action")).toBe("/community?tag=price%20action");
  });

  it("rejects anything that is not a bare query string", () => {
    expect(communityBackHref("tag=nifty")).toBe("/community"); // missing "?"
    expect(communityBackHref("?tag=nifty#x")).toBe("/community"); // fragment
    expect(communityBackHref("?next=/app/settings")).toBe("/community"); // path injection
    expect(communityBackHref("?a=//evil.example")).toBe("/community");
    expect(communityBackHref(`?tag=${"x".repeat(300)}`)).toBe("/community"); // oversized
  });
});
