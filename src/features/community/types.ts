import type { ReactionCounts, ReactionKind } from "./reactions";

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
  createdAt: string;
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
}

export interface CommentView {
  id: string;
  body: string;
  parentId: string | null;
  likeCount: number;
  likedByMe: boolean;
  createdAt: string;
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
  type: "like" | "comment" | "reply" | "follow" | "mention";
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
