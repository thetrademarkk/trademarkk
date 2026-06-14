import { z } from "zod";
import { isAccentId } from "./accents";

export const tradeCardSchema = z.object({
  symbol: z.string().min(1).max(20),
  segment: z.enum(["EQ", "FUT", "OPT", "COMM", "CDS"]),
  strike: z.number().positive().nullish(),
  optionType: z.enum(["CE", "PE"]).nullish(),
  expiry: z.string().max(10).nullish(),
  direction: z.enum(["long", "short"]),
  entry: z.number().positive(),
  exit: z.number().positive().nullish(),
  sl: z.number().positive().nullish(),
  target: z.number().positive().nullish(),
  rMultiple: z.number().min(-100).max(100).nullish(),
  netPnl: z.number().nullish(),
  holdMins: z.number().min(0).nullish(),
  openedAt: z.string().max(30),
});

const tagSchema = z.string().regex(/^[a-z0-9-]{2,20}$/, "Tags: lowercase letters, numbers, dashes");

// ~280KB of base64 ≈ 200KB image. Client compresses to WebP first.
const imageSchema = z
  .string()
  .regex(/^data:image\/(webp|jpeg|png);base64,/)
  .max(400_000, "Image too large");

/**
 * Optional bullish/bearish lean on the tickers a post mentions. `null`/omitted =
 * no sentiment (the default). NEVER a recommendation — feeds an aggregate gauge.
 * Only `"bull"` or `"bear"` are accepted; the empty string clears it on edit.
 */
const sentimentSchema = z.enum(["bull", "bear"]).nullish();

export const createPostSchema = z.object({
  title: z.string().max(120).optional(),
  body: z.string().min(2, "Say something!").max(5000),
  tags: z.array(tagSchema).max(4).default([]),
  tradeCard: tradeCardSchema.nullish(),
  images: z.array(imageSchema).max(2).default([]),
  sentiment: sentimentSchema,
});

/**
 * Reshare / quote-post input. `targetId` is the post being reshared; `body` is
 * optional commentary (empty = a plain reshare, non-empty = a quote). The server
 * collapses a reshare-of-a-reshare to the root original and validates visibility.
 */
export const createReshareSchema = z.object({
  targetId: z.string().min(1).max(40),
  body: z.string().max(5000).optional(),
});

export const createCommentSchema = z.object({
  body: z.string().min(1, "Empty comment").max(2000),
  parentId: z.string().max(40).nullish(),
});

/**
 * Editing a post re-runs the SAME validation as creating one (title/body/tags) —
 * an edit can never bypass the rules a fresh post must pass. Images and the
 * trade card are immutable after creation (not editable in this window).
 */
export const editPostSchema = z.object({
  title: z.string().max(120).optional(),
  body: z.string().min(2, "Say something!").max(5000),
  tags: z.array(tagSchema).max(4).default([]),
  /** Sentiment is editable within the window; omit to leave it unchanged. */
  sentiment: sentimentSchema,
});

/** Editing a comment re-runs the create-comment body validation. */
export const editCommentSchema = z.object({
  body: z.string().min(1, "Empty comment").max(2000),
});

export const updateProfileSchema = z.object({
  username: z
    .string()
    .regex(/^[a-z0-9_]{3,20}$/, "3–20 chars: a-z, 0-9, _")
    .optional(),
  displayName: z.string().min(1).max(40).optional(),
  bio: z.string().max(280).optional(),
  // .url() alone accepts javascript: URLs — the value is rendered as an href,
  // so the scheme must be pinned to http(s).
  website: z
    .string()
    .url("Enter a full URL (https://…)")
    .max(120)
    .regex(/^https?:\/\//i, "Enter a full URL (https://…)")
    .or(z.literal(""))
    .optional(),
  /**
   * Compressed data-url ≤ ~120KB; empty string removes the photo. The scheme is
   * pinned to a base64 raster image (webp/png/jpeg) — `data:image/svg+xml` (which
   * can carry script) and other data-url shapes are rejected.
   */
  avatar: z
    .string()
    .max(160_000)
    .refine((v) => v === "" || /^data:image\/(webp|png|jpeg);base64,/.test(v), "Invalid image")
    .optional(),
  /** Preset cover-accent id only (no free hex); empty string clears it. */
  accent: z
    .string()
    .max(20)
    .refine((v) => v === "" || isAccentId(v), "Unknown accent")
    .optional(),
});

export const shareStreakSchema = z.object({
  share: z.boolean(),
  current: z.number().int().min(0).max(3650),
  best: z.number().int().min(0).max(3650),
});

export const startConversationSchema = z.object({
  username: z.string().regex(/^[a-z0-9_]{3,20}$/, "Invalid username"),
});

export const sendDmSchema = z.object({
  body: z.string().trim().min(1, "Empty message").max(2000, "Keep it under 2000 characters"),
});

/** Editing a DM re-runs the same body validation as sending one. */
export const editDmSchema = z.object({
  body: z.string().trim().min(1, "Empty message").max(2000, "Keep it under 2000 characters"),
});

/** Reacting to a DM with one of the supported message-reaction kinds. */
export const reactDmSchema = z.object({
  reaction: z.enum(["like", "love", "laugh", "celebrate", "sad"]),
});

export const REPORT_REASONS = [
  { id: "spam", label: "Spam or promotion" },
  { id: "harassment", label: "Harassment or abuse" },
  { id: "advice", label: "Financial advice / tips" },
  { id: "other", label: "Something else" },
] as const;

export const reportSchema = z.object({
  targetType: z.enum(["post", "comment"]),
  targetId: z.string().max(40),
  reason: z.enum(["spam", "harassment", "advice", "other"]),
  note: z.string().max(500).optional(),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type CreateReshareInput = z.infer<typeof createReshareSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type EditPostInput = z.infer<typeof editPostSchema>;
export type EditCommentInput = z.infer<typeof editCommentSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type EditDmInput = z.infer<typeof editDmSchema>;
export type ReactDmInput = z.infer<typeof reactDmSchema>;
