import { sqliteTable, text, integer, real, primaryKey, unique } from "drizzle-orm/sqlite-core";

/**
 * Platform DB schema — auth + db-mapping metadata ONLY. Journal data never lives here.
 * Tables `user`, `session`, `account`, `verification` follow Better Auth's expected shape.
 */
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  // ── Email-abuse hardening (durable per-account cooldown + daily caps) ──
  // Epoch-ms of the last sent email of each kind; the daily counter resets
  // inline when the stored timestamp's IST/local date != today (no cron).
  lastPasswordResetEmailAt: integer("last_password_reset_email_at"),
  passwordResetEmailCountToday: integer("password_reset_email_count_today").notNull().default(0),
  lastVerificationEmailAt: integer("last_verification_email_at"),
  verificationEmailCountToday: integer("verification_email_count_today").notNull().default(0),
  lastOtpEmailAt: integer("last_otp_email_at"),
  otpEmailCountToday: integer("otp_email_count_today").notNull().default(0),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

/* ── Community (public content — lives centrally by design) ─────────────── */

export const profiles = sqliteTable("profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  bio: text("bio"),
  website: text("website"),
  avatar: text("avatar"), // compressed webp data-url, ≤ ~80KB
  /** Streaks are journal data (private by design) — published only by opt-in. */
  shareStreak: integer("share_streak").notNull().default(0),
  streakCurrent: integer("streak_current").notNull().default(0),
  streakBest: integer("streak_best").notNull().default(0),
  streakUpdatedAt: text("streak_updated_at"),
  /** The author's one pinned post (shown first on their profile). */
  pinnedPostId: text("pinned_post_id"),
  /** Preset cover-accent id (see features/community/accents.ts) — never free hex. */
  accentColor: text("accent_color"),
  createdAt: text("created_at").notNull(),
});

/** One-way blocks: the blocker stops seeing the blocked user's content. */
export const blocks = sqliteTable(
  "blocks",
  {
    blockerId: text("blocker_id").notNull(),
    blockedId: text("blocked_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] })]
);

export const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text("title"),
  body: text("body").notNull(),
  tradeCard: text("trade_card"), // JSON snapshot shared from the journal
  tags: text("tags"), // JSON string[]
  /** TOTAL reaction count (all kinds). Kept rename-free for back-compat. */
  likeCount: integer("like_count").notNull().default(0),
  /** Denormalized per-kind breakdown JSON, e.g. {"like":3,"insightful":2}; NULL = legacy/all-likes. */
  reactions: text("reactions"),
  commentCount: integer("comment_count").notNull().default(0),
  shareCount: integer("share_count").notNull().default(0),
  /** Number of times this post has been reshared/quoted (denormalized). */
  reshareCount: integer("reshare_count").notNull().default(0),
  /**
   * When set, THIS post is a reshare/quote of the referenced post. A plain
   * reshare has an empty body; a quote carries the resharer's commentary as its
   * body. Always points at a ROOT original (reshares never nest — a reshare of a
   * reshare collapses to the root). NULL = an ordinary post.
   */
  quotePostId: text("quote_post_id"),
  /**
   * Optional, honest community sentiment on the tickers this post mentions:
   * 'bull' | 'bear' | NULL (no lean). NEVER a buy/sell recommendation — it
   * feeds an aggregate per-symbol gauge with a not-advice disclaimer. Only
   * meaningful when the post carries >= 1 $cashtag. NULL = the default (none).
   */
  sentiment: text("sentiment"),
  /**
   * Content-quality moderation flag, set by the create/edit quality gate when a
   * post matches a soft tip/all-caps heuristic (see features/community/quality.ts):
   * 'tip' | 'all-caps' | NULL (clean). NEVER hard-rejects genuine analysis — it
   * tags borderline posts for later moderation review (the admin report queue
   * surfaces flagged posts). Egregious solicitation / low-effort / near-duplicate
   * posts are blocked outright and never reach this column. NULL = the default.
   */
  qualityFlag: text("quality_flag"),
  createdAt: text("created_at").notNull(),
  /** Set the first time the post is edited; null = never edited. */
  editedAt: text("edited_at"),
  /** Append-only JSON array of pre-edit snapshots (see features/community/edit-window.ts). */
  editHistory: text("edit_history"),
});

export const postImages = sqliteTable("post_images", {
  id: text("id").primaryKey(),
  postId: text("post_id").notNull(),
  position: integer("position").notNull().default(0),
  data: text("data").notNull(), // compressed webp data-url ≤ ~280KB
});

/**
 * $cashtag -> post join. One row per (post, symbol) so a post surfaces on each
 * tagged symbol's stream page (/community/s/[symbol]). Symbols are stored
 * UPPERCASE (curated or free-entered). Indexed both ways: by symbol for the
 * per-symbol stream query, by post for cheap re-sync on edit.
 */
export const postSymbols = sqliteTable(
  "post_symbols",
  {
    postId: text("post_id").notNull(),
    symbol: text("symbol").notNull(), // uppercase NSE/BSE ticker token
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.symbol] })]
);

export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  postId: text("post_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  parentId: text("parent_id"), // one-level threading (LinkedIn-style)
  likeCount: integer("like_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  /** Set the first time the comment is edited; null = never edited. */
  editedAt: text("edited_at"),
  /** Append-only JSON array of pre-edit snapshots (see features/community/edit-window.ts). */
  editHistory: text("edit_history"),
});

export const commentLikes = sqliteTable(
  "comment_likes",
  {
    commentId: text("comment_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId] })]
);

export const bookmarks = sqliteTable(
  "bookmarks",
  {
    userId: text("user_id").notNull(),
    postId: text("post_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.postId] })]
);

export const follows = sqliteTable(
  "follows",
  {
    followerId: text("follower_id").notNull(),
    followingId: text("following_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.followerId, t.followingId] })]
);

/**
 * Tags a user has chosen to follow. Posts carrying a followed tag surface in the
 * viewer's Following feed (alongside posts by followed users). PK (user_id, tag)
 * makes follow idempotent; one row per (user, tag).
 */
export const followedTags = sqliteTable(
  "followed_tags",
  {
    userId: text("user_id").notNull(),
    tag: text("tag").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.tag] })]
);

/**
 * Symbols ($cashtags) a user is watching. Posts tagging a watched symbol surface
 * in the viewer's Watchlist feed (alongside posts by followed users). PK
 * (user_id, symbol) makes watch idempotent; one row per (user, symbol). Symbols
 * are stored UPPERCASE (same form as `post_symbols`). Indexed by symbol so the
 * "who watches this ticker" direction stays cheap.
 */
export const watchedSymbols = sqliteTable(
  "watched_symbols",
  {
    userId: text("user_id").notNull(),
    symbol: text("symbol").notNull(), // uppercase NSE/BSE ticker token
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.symbol] })]
);

/** In-app notifications: like | comment | reply | follow | mention. */
export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(), // recipient
  actorId: text("actor_id").notNull(),
  type: text("type").notNull(),
  postId: text("post_id"),
  commentId: text("comment_id"),
  read: integer("read").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const likes = sqliteTable(
  "likes",
  {
    postId: text("post_id").notNull(),
    userId: text("user_id").notNull(),
    /** Reaction kind (like|insightful|respect|celebrate); NULL = legacy plain like. */
    reaction: text("reaction"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })]
);

export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  reporterId: text("reporter_id").notNull(),
  targetType: text("target_type").notNull(), // 'post' | 'comment'
  targetId: text("target_id").notNull(),
  reason: text("reason"),
  createdAt: text("created_at").notNull(),
});

/** Community-submitted blog posts, gated behind admin approval. */
export const blogSubmissions = sqliteTable("blog_submissions", {
  id: text("id").primaryKey(),
  authorId: text("author_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  excerpt: text("excerpt").notNull(),
  contentHtml: text("content_html").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  reviewerNote: text("reviewer_note"),
  createdAt: text("created_at").notNull(),
  reviewedAt: text("reviewed_at"),
});

/** 1:1 direct-message threads. Participants stored in canonical order (userA < userB). */
export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    userA: text("user_a").notNull(),
    userB: text("user_b").notNull(),
    createdAt: text("created_at").notNull(),
    lastMessageAt: text("last_message_at").notNull(),
  },
  (t) => [unique().on(t.userA, t.userB)]
);

export const dmMessages = sqliteTable("dm_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  senderId: text("sender_id").notNull(),
  body: text("body").notNull(), // plain text, ≤ 2000 chars
  createdAt: text("created_at").notNull(),
  read: integer("read").notNull().default(0), // recipient has seen it
});

/**
 * Cache of OG/twitter link previews ("unfurls"). One row per unfurled URL,
 * keyed by a stable hash of the URL so a hot link is fetched once and reused.
 * All text fields are sanitized (plain text, never HTML). A row with all-empty
 * meta is a NEGATIVE cache entry (the link had nothing to show / was unsafe) —
 * still keyed by the URL so we don't re-fetch a dud on every view. `fetchedAt`
 * drives TTL refresh (see features/community/unfurl.ts). Additive + idempotent.
 */
export const linkUnfurls = sqliteTable("link_unfurls", {
  urlHash: text("url_hash").primaryKey(),
  url: text("url").notNull(),
  title: text("title"),
  description: text("description"),
  image: text("image"),
  siteName: text("site_name"),
  fetchedAt: text("fetched_at").notNull(),
});

/** User-submitted product feedback (bug reports, ideas). */
export const feedback = sqliteTable("feedback", {
  id: text("id").primaryKey(),
  userId: text("user_id"), // nullable — anonymous feedback allowed
  email: text("email"),
  category: text("category").notNull().default("idea"), // bug | idea | other
  message: text("message").notNull(),
  path: text("path"),
  createdAt: text("created_at").notNull(),
});

/** First-party page-view events for the admin analytics dashboard. */
export const pageEvents = sqliteTable("page_events", {
  id: text("id").primaryKey(),
  path: text("path").notNull(),
  userId: text("user_id"), // signed-in users only; anonymous views have null
  createdAt: text("created_at").notNull(),
});

/**
 * First-party field web-vitals samples (Core Web Vitals measured on real
 * visits via the `web-vitals` lib). Deliberately PII-free: metric + value +
 * normalized path only — no user id, no IP, no fingerprinting. Vercel exposes
 * no stable REST API for its Web Analytics / Speed Insights data, so the
 * public Pulse page charts these instead.
 */
export const webVitals = sqliteTable("web_vitals", {
  id: text("id").primaryKey(),
  metric: text("metric").notNull(), // LCP | CLS | INP | FCP | TTFB
  value: real("value").notNull(), // ms for timing metrics; unitless score for CLS
  path: text("path").notNull(),
  createdAt: text("created_at").notNull(),
});

/**
 * Durable fixed-window rate-limit store. One row per limiter key; the count is
 * reset when `windowStart` ages past the window. Backs `rateLimit()` so limits
 * actually enforce across serverless cold starts (an in-memory Map would reset
 * per lambda invocation). Old rows are pruned opportunistically.
 */
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: integer("window_start").notNull().default(0), // epoch ms
});

/** One row per user → which Turso DB holds their journal, and which mode they're in. */
export const userDatabases = sqliteTable("user_databases", {
  userId: text("user_id").primaryKey(),
  dbName: text("db_name").notNull(),
  hostname: text("hostname").notNull(),
  storageMode: text("storage_mode").notNull().default("hosted"), // 'hosted' | 'byod'
  status: text("status").notNull().default("active"), // 'active' | 'grace'
  createdAt: text("created_at").notNull(),
  deleteAfter: text("delete_after"),
});
