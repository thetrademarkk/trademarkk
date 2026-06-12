import { sqliteTable, text, integer, primaryKey, unique } from "drizzle-orm/sqlite-core";

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
  likeCount: integer("like_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  shareCount: integer("share_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const postImages = sqliteTable("post_images", {
  id: text("id").primaryKey(),
  postId: text("post_id").notNull(),
  position: integer("position").notNull().default(0),
  data: text("data").notNull(), // compressed webp data-url ≤ ~280KB
});

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
