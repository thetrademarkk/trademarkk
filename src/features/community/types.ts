import type { ReactionCounts, ReactionKind } from "./reactions";
import type { CommentEditSnapshot, PostEditSnapshot } from "./edit-window";
import type { Sentiment } from "./sentiment";
import type { ReputationTier } from "./reputation";

/** A snapshot of a journal trade, shared by explicit user action. Never a live link. */
export interface TradeCard {
  symbol: string;
  segment: "EQ" | "FUT" | "OPT" | "COMM" | "CDS";
  strike?: number | null;
  optionType?: "CE" | "PE" | null;
  expiry?: string | null;
  direction: "long" | "short";
  entry: number;
  exit?: number | null;
  sl?: number | null;
  target?: number | null;
  rMultiple?: number | null;
  /** Only present when the author opted in to sharing ₹ P&L. */
  netPnl?: number | null;
  holdMins?: number | null;
  openedAt: string;
}

export interface AuthorView {
  username: string;
  displayName: string;
  avatar?: string | null;
  /**
   * The author's community-reputation tier (rank-16) — a participation /
   * credibility STANDING, NEVER trading skill or P&L. Drives a small chip next
   * to the author name. Omitted when unknown/not yet computed (renders nothing).
   */
  reputationTier?: ReputationTier;
}

/**
 * The original post embedded inside a reshare/quote, rendered as a nested card.
 * A trimmed projection (no images, snippet body) — enough to preview and link
 * to the original. `unavailable` is true when the original was deleted (render a
 * "post unavailable" placeholder); a block-hidden original is omitted entirely
 * (the embedding reshare carries `quoted: null`).
 */
export interface QuotedPostView {
  id: string;
  title: string | null;
  /** Pre-trimmed snippet of the original body (never the full text). */
  body: string;
  tradeCard: TradeCard | null;
  createdAt: string;
  author: AuthorView;
  /** True when the original has been deleted — render a placeholder, not a link. */
  unavailable: boolean;
}

export interface PostView {
  id: string;
  title: string | null;
  body: string;
  tags: string[];
  tradeCard: TradeCard | null;
  images: string[];
  /** TOTAL reactions across all kinds (kept named likeCount for back-compat). */
  likeCount: number;
  /** Per-kind breakdown for the stacked summary (legacy posts resolve to all-likes). */
  reactionCounts: ReactionCounts;
  commentCount: number;
  shareCount: number;
  /** Times this post has been reshared/quoted (denormalized counter). */
  reshareCount: number;
  /** Set when this post is itself a reshare/quote — points at the ROOT original. */
  quotePostId: string | null;
  /**
   * Optional bullish/bearish lean on the tickers this post mentions, or null.
   * NEVER a recommendation — drives a small chip and the per-symbol gauge.
   */
  sentiment: Sentiment | null;
  /**
   * The embedded original when this post is a reshare/quote. `undefined` for a
   * normal post; an object (possibly `unavailable`) when it reshares something;
   * `null` when the original is hidden from the viewer (e.g. author blocked).
   */
  quoted?: QuotedPostView | null;
  createdAt: string;
  /** Set when the author has edited the post (drives the "Edited" marker); null otherwise. */
  editedAt: string | null;
  /** Append-only prior-version snapshots, oldest first (empty when never edited). */
  editHistory: PostEditSnapshot[];
  /** True when the viewer has ANY reaction on this post (back-compat with old `likedByMe`). */
  likedByMe: boolean;
  /** The viewer's specific reaction, or null. `like` for legacy rows. */
  myReaction: ReactionKind | null;
  bookmarkedByMe: boolean;
  mine: boolean;
  /** True when the author pinned this post to their profile. */
  pinned: boolean;
  author: AuthorView;
}

/** Compact card in the detail page's "More like this" rail (no images on purpose). */
export interface RelatedPostView {
  id: string;
  title: string | null;
  body: string;
  tags: string[];
  likeCount: number;
  commentCount: number;
  createdAt: string;
  author: AuthorView;
}

export interface PostDetailResponse {
  post: PostView;
  comments: CommentView[];
  related: RelatedPostView[];
  /** True when the rail actually shares tags (heading copy differs otherwise). */
  relatedByTag: boolean;
  /** Whether the signed-in viewer follows the author (false when signed out / own post). */
  authorFollowedByMe: boolean;
  /**
   * Set when this post is an auto-created event/market-session thread (rank-18) —
   * drives the pinned "automated session thread" header. Absent for ordinary posts.
   */
  eventThread?: { type: "market-open" | "expiry-day"; date: string } | null;
}

export interface CommentView {
  id: string;
  body: string;
  parentId: string | null;
  likeCount: number;
  likedByMe: boolean;
  createdAt: string;
  /** Set when the author has edited the comment; null otherwise. */
  editedAt: string | null;
  /** Append-only prior-version snapshots, oldest first (empty when never edited). */
  editHistory: CommentEditSnapshot[];
  mine: boolean;
  author: AuthorView;
}

export interface ProfileView {
  username: string;
  displayName: string;
  bio: string | null;
  website: string | null;
  avatar: string | null;
  /** Preset cover-accent id (renders the header gradient band), or null. */
  accent: string | null;
  createdAt: string;
  postCount: number;
  commentCount: number;
  likeCount: number;
  followerCount: number;
  followingCount: number;
  followedByMe: boolean;
  blockedByMe: boolean;
  /** Present only when the user opted in to publishing their streak. */
  streak: { current: number; best: number } | null;
  /**
   * Community-reputation STANDING (rank-16) — participation/credibility, NEVER
   * trading skill or P&L. Carries the tier + a transparent "why this tier"
   * breakdown. Null when it couldn't be computed (the UI then renders nothing).
   */
  reputation: ProfileReputation | null;
}

/** The reputation block surfaced on a profile (tier + transparent breakdown). */
export interface ProfileReputation {
  score: number;
  tier: ReputationTier;
  tierLabel: string;
  tierBlurb: string;
  components: ReputationComponentView[];
}

/** One transparent line of the profile's reputation breakdown. */
export interface ReputationComponentView {
  key: string;
  label: string;
  points: number;
  detail: number;
}

/** One row in a profile's Comments tab — the comment plus its post context. */
export interface ProfileCommentView {
  id: string;
  body: string;
  likeCount: number;
  createdAt: string;
  post: { id: string; title: string | null; body: string };
}

export interface LeaderboardRow {
  rank: number;
  username: string;
  displayName: string;
  avatar: string | null;
  /** Community-standing tier (rank-16) — participation/credibility, not P&L. */
  reputationTier?: ReputationTier;
  /** Contributors board */
  score?: number;
  posts?: number;
  comments?: number;
  likesReceived?: number;
  /** Streaks board */
  current?: number;
  best?: number;
  me: boolean;
}

export interface NotificationView {
  id: string;
  type: "like" | "comment" | "reply" | "follow" | "mention" | "reshare";
  actor: AuthorView;
  postId: string | null;
  read: boolean;
  createdAt: string;
}

/** One row in the DM inbox — the other participant + thread snapshot. */
export interface ConversationView {
  id: string;
  peer: AuthorView;
  lastMessage: { body: string; mine: boolean; createdAt: string } | null;
  unread: number;
  lastMessageAt: string;
}

export interface DmMessageView {
  id: string;
  body: string;
  mine: boolean;
  createdAt: string;
}

export interface FeedResponse {
  posts: PostView[];
  nextCursor: string | null;
}

/* ── Header search (Search v2) — compact unified results, no image payloads ── */

export interface SearchUserView {
  username: string;
  displayName: string;
  avatar: string | null;
  bio: string | null;
}

export interface SearchPostView {
  id: string;
  title: string | null;
  /** Pre-trimmed window around the first match — never the full body. */
  snippet: string;
  author: AuthorView;
  likeCount: number;
  commentCount: number;
  createdAt: string;
}

export interface SearchResponse {
  users: SearchUserView[];
  tags: { tag: string; count: number }[];
  posts: SearchPostView[];
}

export const SUGGESTED_TAGS = [
  "nifty",
  "banknifty",
  "options",
  "futures",
  "psychology",
  "setups",
  "question",
  "review",
] as const;
