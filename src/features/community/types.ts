/** A snapshot of a journal trade, shared by explicit user action. Never a live link. */
export interface TradeCard {
  symbol: string;
  segment: "EQ" | "FUT" | "OPT";
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
  likeCount: number;
  commentCount: number;
  createdAt: string;
  likedByMe: boolean;
  bookmarkedByMe: boolean;
  mine: boolean;
  author: AuthorView;
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
  createdAt: string;
  postCount: number;
  followerCount: number;
  followingCount: number;
  followedByMe: boolean;
  blockedByMe: boolean;
  /** Present only when the user opted in to publishing their streak. */
  streak: { current: number; best: number } | null;
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

export interface FeedResponse {
  posts: PostView[];
  nextCursor: string | null;
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
