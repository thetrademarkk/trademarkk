import { describe, expect, it } from "vitest";
import {
  createPostSchema,
  editPostSchema,
  createCommentSchema,
  updateProfileSchema,
  startConversationSchema,
  sendDmSchema,
} from "./schemas";
import { submitBlogSchema } from "@/features/blog/schemas";

describe("createPostSchema", () => {
  it("accepts a minimal valid post", () => {
    const r = createPostSchema.safeParse({ body: "Hello traders" });
    expect(r.success).toBe(true);
  });
  it("rejects an empty body", () => {
    expect(createPostSchema.safeParse({ body: "" }).success).toBe(false);
  });
  it("rejects more than 4 tags", () => {
    expect(
      createPostSchema.safeParse({ body: "hi there", tags: ["a", "b", "c", "d", "e"] }).success
    ).toBe(false);
  });
  it("rejects malformed tags", () => {
    expect(createPostSchema.safeParse({ body: "hi there", tags: ["NotLower"] }).success).toBe(
      false
    );
  });
  it("caps body length", () => {
    expect(createPostSchema.safeParse({ body: "x".repeat(5001) }).success).toBe(false);
  });
  it("accepts an optional bull/bear/null sentiment and omitting it", () => {
    expect(createPostSchema.safeParse({ body: "long $NIFTY", sentiment: "bull" }).success).toBe(
      true
    );
    expect(createPostSchema.safeParse({ body: "short $NIFTY", sentiment: "bear" }).success).toBe(
      true
    );
    expect(createPostSchema.safeParse({ body: "neutral $NIFTY", sentiment: null }).success).toBe(
      true
    );
    expect(createPostSchema.safeParse({ body: "no sentiment field" }).success).toBe(true);
  });
  it("rejects an unknown sentiment value", () => {
    expect(createPostSchema.safeParse({ body: "hi", sentiment: "neutral" }).success).toBe(false);
    expect(createPostSchema.safeParse({ body: "hi", sentiment: "BULL" }).success).toBe(false);
  });
});

describe("editPostSchema", () => {
  it("re-runs body/tag validation and accepts an optional sentiment", () => {
    expect(editPostSchema.safeParse({ body: "edited $NIFTY", sentiment: "bull" }).success).toBe(
      true
    );
    expect(editPostSchema.safeParse({ body: "edited", sentiment: null }).success).toBe(true);
    expect(editPostSchema.safeParse({ body: "edited" }).success).toBe(true); // omitted = unchanged
    expect(editPostSchema.safeParse({ body: "" }).success).toBe(false);
    expect(editPostSchema.safeParse({ body: "edited", sentiment: "x" }).success).toBe(false);
  });
});

describe("createCommentSchema", () => {
  it("rejects empty", () =>
    expect(createCommentSchema.safeParse({ body: "" }).success).toBe(false));
  it("accepts text", () =>
    expect(createCommentSchema.safeParse({ body: "good" }).success).toBe(true));
});

describe("updateProfileSchema", () => {
  it("accepts a valid username", () =>
    expect(updateProfileSchema.safeParse({ username: "nifty_scalper" }).success).toBe(true));
  it("rejects uppercase / short usernames", () => {
    expect(updateProfileSchema.safeParse({ username: "AB" }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ username: "Nifty" }).success).toBe(false);
  });
  it("accepts a base64 raster avatar data-url and the empty (remove) value", () => {
    expect(updateProfileSchema.safeParse({ avatar: "data:image/webp;base64,AAAA" }).success).toBe(
      true
    );
    expect(updateProfileSchema.safeParse({ avatar: "data:image/png;base64,AAAA" }).success).toBe(
      true
    );
    expect(updateProfileSchema.safeParse({ avatar: "" }).success).toBe(true);
  });
  it("rejects non-raster / script-bearing avatar data-urls", () => {
    // svg+xml can carry script; only webp/png/jpeg base64 are allowed.
    expect(
      updateProfileSchema.safeParse({ avatar: "data:image/svg+xml;base64,PHN2Zz4=" }).success
    ).toBe(false);
    expect(updateProfileSchema.safeParse({ avatar: "data:text/html,<script>" }).success).toBe(
      false
    );
    expect(updateProfileSchema.safeParse({ avatar: "data:image/gif;base64,AAAA" }).success).toBe(
      false
    );
  });
});

describe("startConversationSchema", () => {
  it("accepts a valid username", () =>
    expect(startConversationSchema.safeParse({ username: "nifty_scalper" }).success).toBe(true));
  it("rejects uppercase, short and malformed usernames", () => {
    expect(startConversationSchema.safeParse({ username: "Nifty" }).success).toBe(false);
    expect(startConversationSchema.safeParse({ username: "ab" }).success).toBe(false);
    expect(startConversationSchema.safeParse({ username: "a'; --" }).success).toBe(false);
  });
});

describe("sendDmSchema", () => {
  it("accepts a normal message", () =>
    expect(sendDmSchema.safeParse({ body: "hey, nice trade" }).success).toBe(true));
  it("rejects whitespace-only bodies", () =>
    expect(sendDmSchema.safeParse({ body: "   " }).success).toBe(false));
  it("caps the body at 2000 characters", () => {
    expect(sendDmSchema.safeParse({ body: "x".repeat(2000) }).success).toBe(true);
    expect(sendDmSchema.safeParse({ body: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("submitBlogSchema", () => {
  it("requires a substantive title, excerpt and content", () => {
    expect(
      submitBlogSchema.safeParse({
        title: "Lessons from expiry day trading",
        excerpt: "A short but sufficiently long summary of the article.",
        contentHtml: "<p>" + "word ".repeat(20) + "</p>",
      }).success
    ).toBe(true);
  });
  it("rejects a too-short title", () => {
    expect(
      submitBlogSchema.safeParse({
        title: "Hi",
        excerpt: "x".repeat(25),
        contentHtml: "x".repeat(50),
      }).success
    ).toBe(false);
  });
});
