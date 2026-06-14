import type { ReactionCounts, ReactionKind } from "./reactions";
import type { CommentEditSnapshot, PostEditSnapshot } from "./edit-window";
import type { Sentiment } from "./sentiment";
import type { ReputationTier } from "./reputation";
import type { AwardId } from "./awards";
import type { MessageReactionMap } from "./dm-v2";
import type { LinkUnfurl } from "./unfurl";

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
  /**
   * The author's earned achievement-AWARD ids (rank-20). The author chip shows
   * ONE subtle featured (rarest) badge from this set. Omitted/empty when none —
   * banned/flagged members have an empty set. Participation only, never P&L.
   */
  awards?: AwardId[];
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
  /**
   * Set (to a short reason like `"scam"` / `$RELIANCE`) when this comment matches
   * one of the VIEWER's personal muted words. In a thread we never hard-hide a
   * comment (it would break reply chains) — instead the client COLLAPSES it with
   * a "hidden by your muted words — show anyway?" reveal. Personal only; absent
   * for the viewer's own comments and for signed-out viewers.
   */
  mutedReason?: string | null;
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
  /**
   * Earned achievement-AWARD badge ids (rank-20), computed from the SAME earned
   * signal bundle as the reputation tier. Drives the profile badges row + the
   * Achievements section. Empty for a banned/flagged member. Participation only.
   */
  awards: AwardId[];
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
  type: "like" | "comment" | "reply" | "follow" | "mention" | "reshare" | "message";
  actor: AuthorView;
  postId: string | null;
  read: boolean;
  createdAt: string;
}

/** One row in the DM inbox — the other participant + thread snapshot. */
export interface ConversationView {
  id: string;
  peer: AuthorView;
  lastMessage: {
    body: string;
    mine: boolean;
    createdAt: string;
    /** True when the inbox preview should read "Message deleted" (tombstone). */
    deleted: boolean;
  } | null;
  unread: number;
  lastMessageAt: string;
}

/** A rich attachment derived from the first link in a message (DM v2). */
export interface DmAttachment {
  kind: "image" | "link";
  url: string;
  /** Present for link cards (resolved server-side via the unfurl path); null for images. */
  unfurl?: LinkUnfurl | null;
}

export interface DmMessageView {
  id: string;
  /** The (possibly empty) message body. Empty + deleted = tombstone. */
  body: string;
  mine: boolean;
  createdAt: string;
  /** DM v2: per-message reactions (userId -> kind). Omitted/empty when none. */
  reactions: MessageReactionMap;
  /** DM v2: set when the sender edited the message; null otherwise. */
  editedAt: string | null;
  /** DM v2: append-only prior-body snapshots, oldest first (empty when never edited). */
  editHistory: CommentEditSnapshot[];
  /** DM v2: set when soft-deleted — render the tombstone, suppress body/attachment. */
  deletedAt: string | null;
  /** DM v2: classified first-link attachment (image preview or link card), or null. */
  attachment: DmAttachment | null;
}

/**
 * Per-thread DM v2 state surfaced alongside the messages on each poll: the
 * peer's seen/typing derived from their last-read/typing columns. Drives the
 * sender's sent→delivered→seen ticks and the typing bubble. Cheap — read from
 * the conversation row the thread query already loads.
 */
export interface ThreadState {
  /** Peer's last-read message ISO timestamp (or null) — drives "seen" ticks. */
  peerLastReadAt: string | null;
  /** Peer's last thread-activity ISO timestamp (or null) — drives "delivered". */
  peerLastSeenAt: string | null;
  /** Peer's typing heartbeat ISO timestamp (or null) — TTL-checked client-side. */
  peerTypingAt: string | null;
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
