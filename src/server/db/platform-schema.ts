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
  /**
   * Account moderation status: 'banned' = suspended (blocked from posting/
   * commenting at the create endpoints with a 403), NULL = active. Additive,
   * idempotent — set/cleared only by an admin via the moderation queue.
   */
  status: text("status"),
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
  /**
   * Denormalized community-reputation cache (see features/community/reputation.ts).
   * NOT trading skill / P&L — a participation/credibility standing computed from
   * earned, anti-gaming signals (tenure, posts, reactions from OTHERS, followers
   * with diminishing returns, MINUS moderation penalties). Refreshed LAZILY on a
   * stale read (no cron); recomputable from scratch any time, so these are pure
   * caches. NULL = never computed yet (the reader computes on first access).
   */
  reputationScore: integer("reputation_score"),
  reputationTier: text("reputation_tier"),
  reputationComputedAt: text("reputation_computed_at"),
  /**
   * Denormalized achievement-AWARDS cache (see features/community/awards.ts) — a
   * compact JSON array of the EARNED badge-ids (e.g. `["one-year","well-received"]`).
   * Computed in the SAME pass as the reputation cache from the SAME earned signal
   * bundle, refreshed LAZILY on the same 6h stale read (no extra cron). Like the
   * reputation columns these are pure caches — recomputable from scratch any time.
   * NULL = never computed yet. Badges reflect community participation only, NEVER
   * trading skill / P&L; a banned or quality-flagged member's set is empty.
   */
  awards: text("awards"),
  /**
   * Per-type in-app notification preferences (see
   * features/community/notification-prefs.ts). A compact JSON map of ONLY the
   * types the user has switched OFF (e.g. `{"follow":false}`); NULL/absent means
   * every type is enabled (the default — no behaviour change for existing users).
   */
  notificationPrefs: text("notification_prefs"),
  /**
   * Personal "muted words" content filter (see features/community/muted-words.ts).
   * A compact JSON array of the user's mute entries (term + match mode + optional
   * case-sensitivity / scope / expiry); NULL/absent means no mutes (the default —
   * no behaviour change for existing users). Strictly PERSONAL: hides matching
   * posts/comments from THIS user's own feeds/threads only — never moderation.
   */
  mutedWords: text("muted_words"),
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
  /**
   * Lifecycle: 'open' (awaiting review) | 'actioned' (dismissed/resolved by a
   * moderator). Dismissing marks the report actioned rather than deleting it so
   * the moderation queue keeps an open-vs-actioned history. Defaults to 'open'.
   */
  status: text("status").notNull().default("open"),
  createdAt: text("created_at").notNull(),
});

/**
 * Append-only moderation audit log: one row per moderator action (dismiss /
 * delete-content / clear-flag / ban-user / unban-user) so every action is
 * traceable. Kept deliberately simple — no soft-delete, no edits. Admin-only.
 */
export const modActions = sqliteTable("mod_actions", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").notNull(), // the admin who acted
  action: text("action").notNull(), // see features/community/moderation.ts MOD_ACTIONS
  targetType: text("target_type").notNull(), // 'post' | 'comment' | 'user' | 'report'
  targetId: text("target_id").notNull(),
  detail: text("detail"), // optional context (e.g. the report id, or a short note)
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

/**
 * 1:1 direct-message threads. Participants stored in canonical order (userA < userB).
 *
 * DM v2 adds per-participant ephemeral/derived state, all additive + idempotent:
 *  - `lastReadA/B`   — each participant's last-read message ISO timestamp; drives
 *    unread badges and the sender's sent→delivered→seen ticks (one indexed read
 *    on the existing thread poll, no extra table).
 *  - `lastSeenA/B`   — each participant's last thread-activity ISO timestamp
 *    (set on thread poll/open); drives the "delivered" state (the peer's client
 *    has the message) distinct from "seen" (they actually read up to it).
 *  - `typingA/B`     — a short-TTL typing heartbeat ISO timestamp per participant
 *    (see features/community/dm-v2.ts TYPING_TTL_MS); the thread poll surfaces it
 *    and it expires a few seconds after the last keystroke. Ephemeral, no infra.
 * Suffix A/B maps to userA/userB (canonical order) so there's exactly one row.
 */
export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    userA: text("user_a").notNull(),
    userB: text("user_b").notNull(),
    createdAt: text("created_at").notNull(),
    lastMessageAt: text("last_message_at").notNull(),
    lastReadA: text("last_read_a"),
    lastReadB: text("last_read_b"),
    lastSeenA: text("last_seen_a"),
    lastSeenB: text("last_seen_b"),
    typingA: text("typing_a"),
    typingB: text("typing_b"),
  },
  (t) => [unique().on(t.userA, t.userB)]
);

export const dmMessages = sqliteTable("dm_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  senderId: text("sender_id").notNull(),
  body: text("body").notNull(), // plain text, ≤ 2000 chars
  createdAt: text("created_at").notNull(),
  read: integer("read").notNull().default(0), // recipient has seen it (v1; superseded by last_read_*)
  // ── DM v2: per-message reactions + edit window + soft-delete tombstone ──
  /** Per-message reactions: compact JSON map of userId -> kind (see dm-v2.ts). NULL = none. */
  reactions: text("reactions"),
  /** Set the first time the sender edits the message; null = never edited. */
  editedAt: text("edited_at"),
  /** Append-only JSON array of pre-edit body snapshots (reuses edit-window.ts). */
  editHistory: text("edit_history"),
  /** Set when the sender soft-deletes the message; the row stays as a tombstone. */
  deletedAt: text("deleted_at"),
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

/**
 * Recurring market-session / event threads (rank-18). One row per
 * (event_type, event_date) — a UNIQUE natural key that makes lazy, visit-
 * triggered materialization race-safe (INSERT OR IGNORE): two concurrent first
 * visits on a day produce exactly ONE thread. `post_id` references the
 * auto-created post (authored by the house/system account, pinned + tagged).
 * No cron — threads are materialized on first visit of an active day. Additive,
 * idempotent.
 */
export const eventThreads = sqliteTable(
  "event_threads",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(), // see features/community/events.ts EventType
    eventDate: text("event_date").notNull(), // IST YYYY-MM-DD
    postId: text("post_id").notNull(), // the auto-created thread post
    createdAt: text("created_at").notNull(),
  },
  (t) => [unique().on(t.eventType, t.eventDate)]
);

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
