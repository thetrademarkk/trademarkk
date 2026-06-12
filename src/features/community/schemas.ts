import { z } from "zod";

export const tradeCardSchema = z.object({
  symbol: z.string().min(1).max(20),
  segment: z.enum(["EQ", "FUT", "OPT"]),
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

export const createPostSchema = z.object({
  title: z.string().max(120).optional(),
  body: z.string().min(2, "Say something!").max(5000),
  tags: z.array(tagSchema).max(4).default([]),
  tradeCard: tradeCardSchema.nullish(),
  images: z.array(imageSchema).max(2).default([]),
});

export const createCommentSchema = z.object({
  body: z.string().min(1, "Empty comment").max(2000),
  parentId: z.string().max(40).nullish(),
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
  /** Compressed data-url ≤ ~120KB; empty string removes the photo. */
  avatar: z
    .string()
    .max(160_000)
    .refine((v) => v === "" || v.startsWith("data:image/"), "Invalid image")
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
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
