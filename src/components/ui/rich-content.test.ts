import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RichContent, PROSE_CLASS } from "./rich-content";

// RichContent is the read-only renderer extracted out of the TipTap editor
// module so the ISR blog article route ships zero editor JS. These tests lock
// the contract that matters: it renders stored HTML verbatim and always carries
// the prose vocabulary, with no client-only dependencies (it renders cleanly via
// renderToStaticMarkup in a plain node environment — i.e. it's server-safe).

describe("PROSE_CLASS", () => {
  it("is a non-empty string carrying the prose vocabulary", () => {
    expect(typeof PROSE_CLASS).toBe("string");
    expect(PROSE_CLASS).toContain("prose-tm");
    expect(PROSE_CLASS).toContain("max-w-none");
  });
});

describe("RichContent", () => {
  it("renders stored HTML verbatim via dangerouslySetInnerHTML", () => {
    const html = "<h2>Heading</h2><p>Body <strong>bold</strong></p>";
    const out = renderToStaticMarkup(createElement(RichContent, { html }));
    expect(out).toContain("<h2>Heading</h2>");
    expect(out).toContain("<strong>bold</strong>");
  });

  it("always applies PROSE_CLASS and merges an optional className", () => {
    const out = renderToStaticMarkup(
      createElement(RichContent, { html: "<p>x</p>", className: "mt-8 text-[15px]" })
    );
    expect(out).toContain("prose-tm");
    expect(out).toContain("mt-8");
    expect(out).toContain("text-[15px]");
  });

  it("renders an empty wrapper for empty HTML without throwing", () => {
    const out = renderToStaticMarkup(createElement(RichContent, { html: "" }));
    expect(out).toContain("prose-tm");
    // The wrapper div exists even with no inner content.
    expect(out.startsWith("<div")).toBe(true);
  });
});
