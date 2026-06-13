/**
 * Creates the platform DB tables (Better Auth + user_databases) on your Turso DB.
 * Run: npm run migrate:platform
 */
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Minimal .env.local loader (no dotenv dependency).
function loadEnv() {
  try {
    const content = readFileSync(join(process.cwd(), ".env.local"), "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? "";
    }
  } catch {
    /* no .env.local — rely on real env */
  }
}

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS user (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS account (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    access_token TEXT,
    refresh_token TEXT,
    id_token TEXT,
    access_token_expires_at INTEGER,
    refresh_token_expires_at INTEGER,
    scope TEXT,
    password TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER,
    updated_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS user_databases (
    user_id TEXT PRIMARY KEY,
    db_name TEXT NOT NULL,
    hostname TEXT NOT NULL,
    storage_mode TEXT NOT NULL DEFAULT 'hosted',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    delete_after TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    bio TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    title TEXT,
    body TEXT NOT NULL,
    trade_card TEXT,
    tags TEXT,
    like_count INTEGER NOT NULL DEFAULT 0,
    comment_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS post_images (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS likes (
    post_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (post_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS blog_submissions (
    id TEXT PRIMARY KEY,
    author_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    excerpt TEXT NOT NULL,
    content_html TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewer_note TEXT,
    created_at TEXT NOT NULL,
    reviewed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_blog_status ON blog_submissions (status, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    email TEXT,
    category TEXT NOT NULL DEFAULT 'idea',
    message TEXT NOT NULL,
    path TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS page_events (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    user_id TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_page_events_time ON page_events (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_page_events_path ON page_events (path)`,
  // ── First-party field web vitals (PII-free; charted on the public /pulse page) ──
  `CREATE TABLE IF NOT EXISTS web_vitals (
    id TEXT PRIMARY KEY,
    metric TEXT NOT NULL,
    value REAL NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_web_vitals_metric_time ON web_vitals (metric, created_at DESC)`,
  // ── Community v2: threading, comment likes, bookmarks, follows, notifications ──
  `CREATE TABLE IF NOT EXISTS comment_likes (
    comment_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (comment_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS bookmarks (
    user_id TEXT NOT NULL,
    post_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, post_id)
  )`,
  `CREATE TABLE IF NOT EXISTS follows (
    follower_id TEXT NOT NULL,
    following_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (follower_id, following_id)
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    type TEXT NOT NULL,
    post_id TEXT,
    comment_id TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS blocks (
    blocker_id TEXT NOT NULL,
    blocked_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id)
  )`,
  // ── Direct messages v1: 1:1 conversations (user_a < user_b, canonical order) ──
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_a TEXT NOT NULL,
    user_b TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_message_at TEXT NOT NULL,
    UNIQUE (user_a, user_b)
  )`,
  `CREATE TABLE IF NOT EXISTS dm_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_dm_messages_convo ON dm_messages (conversation_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_user_a ON conversations (user_a, last_message_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_user_b ON conversations (user_b, last_message_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, read, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_follows_following ON follows (following_id)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_user ON posts (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id)`,
  `CREATE INDEX IF NOT EXISTS idx_post_images_post ON post_images (post_id)`,
  // ── $cashtag → post join (per-symbol stream pages /community/s/[symbol]) ──
  `CREATE TABLE IF NOT EXISTS post_symbols (
    post_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (post_id, symbol)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_post_symbols_symbol ON post_symbols (symbol, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_post_symbols_post ON post_symbols (post_id)`,
  // ── Follow-a-tag: tags a user follows surface in their Following feed ──
  `CREATE TABLE IF NOT EXISTS followed_tags (
    user_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, tag)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_followed_tags_user ON followed_tags (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_followed_tags_tag ON followed_tags (tag)`,
  // ── Watchlist: symbols a user watches surface in their Watchlist feed scope ──
  `CREATE TABLE IF NOT EXISTS watched_symbols (
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, symbol)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_watched_symbols_user ON watched_symbols (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_watched_symbols_symbol ON watched_symbols (symbol)`,
  `CREATE INDEX IF NOT EXISTS idx_session_user ON session (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_session_token ON session (token)`,
  `CREATE INDEX IF NOT EXISTS idx_account_user ON account (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification (identifier)`,
  // ── Durable rate-limit store: fixed-window counter keyed by an opaque string ──
  // Enforces limits on serverless cold starts (an in-memory Map resets per
  // lambda). Pruned opportunistically; no cron needed.
  `CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL DEFAULT 0
  )`,
  // Hot-path / abuse-sweep indexes on existing community tables.
  `CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks (blocker_id, blocked_id)`,
  `CREATE INDEX IF NOT EXISTS idx_likes_user ON likes (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_user ON comments (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows (follower_id)`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback (created_at)`,
  // ── Link OG unfurl cache: one sanitized preview per unfurled URL (TTL refresh) ──
  // url_hash PK = stable hash of the URL; all-empty meta rows are negative caches.
  `CREATE TABLE IF NOT EXISTS link_unfurls (
    url_hash TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT,
    description TEXT,
    image TEXT,
    site_name TEXT,
    fetched_at TEXT NOT NULL
  )`,
  // ── Moderation audit log: one append-only row per moderator action so every
  // dismiss / delete / ban is traceable (who, what, which target, when). Simple
  // by design — no soft-delete, no edits. ──
  `CREATE TABLE IF NOT EXISTS mod_actions (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mod_actions_time ON mod_actions (created_at DESC)`,
  // ── Event / market-session threads (rank-18): one row per (event_type,
  // event_date), UNIQUE so lazy visit-triggered materialization is race-safe
  // (INSERT OR IGNORE → exactly one thread per active day). post_id references
  // the auto-created house-account thread. No cron. ──
  `CREATE TABLE IF NOT EXISTS event_threads (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    event_date TEXT NOT NULL,
    post_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (event_type, event_date)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_event_threads_date ON event_threads (event_date DESC)`,
];

async function main() {
  loadEnv();
  const url = process.env.TURSO_PLATFORM_DB_URL;
  const token = process.env.TURSO_PLATFORM_DB_TOKEN;
  if (!url || !token) {
    console.error("Missing TURSO_PLATFORM_DB_URL / TURSO_PLATFORM_DB_TOKEN");
    process.exit(1);
  }
  const client = createClient({ url: url.replace(/^libsql:\/\//, "https://"), authToken: token });
  for (const sql of STATEMENTS) {
    await client.execute(sql);
    console.log("OK:", sql.trim().slice(0, 60).replace(/\s+/g, " "), "…");
  }

  // Column additions to existing tables — best-effort (no-op when already applied).
  const ALTERS = [
    `ALTER TABLE comments ADD COLUMN parent_id TEXT`,
    `ALTER TABLE comments ADD COLUMN like_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE profiles ADD COLUMN website TEXT`,
    `ALTER TABLE profiles ADD COLUMN avatar TEXT`,
    `ALTER TABLE profiles ADD COLUMN share_streak INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE profiles ADD COLUMN streak_current INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE profiles ADD COLUMN streak_best INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE profiles ADD COLUMN streak_updated_at TEXT`,
    `ALTER TABLE posts ADD COLUMN share_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE profiles ADD COLUMN pinned_post_id TEXT`,
    `ALTER TABLE profiles ADD COLUMN accent_color TEXT`,
    // ── Richer reactions: per-user reaction kind + denormalized per-post breakdown ──
    // Existing rows keep NULL = legacy plain "like"; likeCount stays the TOTAL.
    `ALTER TABLE likes ADD COLUMN reaction TEXT`,
    `ALTER TABLE posts ADD COLUMN reactions TEXT`,
    // ── Edit window + immutable history: when last edited, and an append-only
    // JSON array of pre-edit snapshots. NULL edited_at = never edited; the
    // history can only ever grow (no edit deletes/rewrites a prior snapshot). ──
    `ALTER TABLE posts ADD COLUMN edited_at TEXT`,
    `ALTER TABLE posts ADD COLUMN edit_history TEXT`,
    `ALTER TABLE comments ADD COLUMN edited_at TEXT`,
    `ALTER TABLE comments ADD COLUMN edit_history TEXT`,
    // ── Quote post / reshare: a reshare is a NEW post whose quote_post_id points
    // at the (root) original; reshare_count is the original's denormalized tally.
    // Existing rows default to 0 / NULL — additive, idempotent. ──
    `ALTER TABLE posts ADD COLUMN reshare_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN quote_post_id TEXT`,
    // ── Optional bullish/bearish sentiment tag: 'bull' | 'bear' | NULL.
    // NEVER a recommendation — feeds an aggregate per-symbol gauge. Existing
    // rows default to NULL (no lean) — additive, idempotent. ──
    `ALTER TABLE posts ADD COLUMN sentiment TEXT`,
    // ── Content-quality moderation flag: 'tip' | 'all-caps' | NULL (clean).
    // Set by the create/edit quality gate for borderline posts (genuine analysis
    // is never flagged; egregious spam is blocked outright, never stored).
    // Existing rows default to NULL — additive, idempotent. ──
    `ALTER TABLE posts ADD COLUMN quality_flag TEXT`,
    // ── User suspension/ban: 'banned' | NULL (active). A banned user is blocked
    // from creating posts/comments/reshares at the create endpoints with a 403;
    // their existing content stays (a moderator can also delete it). Additive,
    // idempotent — existing rows default to NULL (active). ──
    `ALTER TABLE user ADD COLUMN status TEXT`,
    // ── Report lifecycle: 'open' (needs review) | 'actioned' (dismissed/resolved).
    // Dismissing a report now marks it actioned instead of deleting the row, so the
    // moderation queue can show an open-vs-actioned history. Existing rows backfill
    // to 'open' via the UPDATE below. Additive, idempotent. ──
    `ALTER TABLE reports ADD COLUMN status TEXT NOT NULL DEFAULT 'open'`,
    // ── Email-abuse hardening: durable per-account cooldown + daily caps ──
    // Counters reset inline when the stored timestamp's date != today (no cron).
    `ALTER TABLE user ADD COLUMN last_password_reset_email_at INTEGER`,
    `ALTER TABLE user ADD COLUMN password_reset_email_count_today INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE user ADD COLUMN last_verification_email_at INTEGER`,
    `ALTER TABLE user ADD COLUMN verification_email_count_today INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE user ADD COLUMN last_otp_email_at INTEGER`,
    `ALTER TABLE user ADD COLUMN otp_email_count_today INTEGER NOT NULL DEFAULT 0`,
    // ── Community reputation cache (see features/community/reputation.ts) ──
    // Denormalized participation/credibility STANDING (NOT trading skill/P&L):
    // a bounded 0–100 score + discrete tier, computed from earned anti-gaming
    // signals and refreshed LAZILY on a stale read (no cron). Pure caches —
    // recomputable from scratch. Existing rows default to NULL (compute on read).
    `ALTER TABLE profiles ADD COLUMN reputation_score INTEGER`,
    `ALTER TABLE profiles ADD COLUMN reputation_tier TEXT`,
    `ALTER TABLE profiles ADD COLUMN reputation_computed_at TEXT`,
    // ── Per-type in-app notification preferences (notification-prefs.ts) ──
    // A compact JSON map of ONLY the types the user has switched OFF; NULL means
    // every type is enabled (the default — existing users see no behaviour
    // change). `notify()` consults this at emit time and skips opted-out types.
    `ALTER TABLE profiles ADD COLUMN notification_prefs TEXT`,
    // ── Achievement awards / badges cache (see features/community/awards.ts) ──
    // A compact JSON array of EARNED badge-ids, computed in the SAME pass as the
    // reputation cache from the SAME earned signal bundle and refreshed LAZILY on
    // the same 6h stale read (no extra cron). Pure cache — recomputable from
    // scratch. NULL = never computed (compute on read). Badges reflect community
    // participation only, never trading skill / P&L; banned/flagged members earn
    // none.
    `ALTER TABLE profiles ADD COLUMN awards TEXT`,
  ];
  for (const sql of ALTERS) {
    try {
      await client.execute(sql);
      console.log("OK:", sql);
    } catch {
      console.log("skip (exists):", sql);
    }
  }

  // Indexes that reference columns added in ALTERS must run AFTER them (on a
  // fresh DB the column wouldn't exist when STATEMENTS run). Idempotent.
  const POST_ALTER_INDEXES = [
    // Moderation: cheap "show me flagged posts, newest first" scan for the admin
    // queue. The vast majority of rows have a NULL quality_flag (cheap to skip).
    `CREATE INDEX IF NOT EXISTS idx_posts_quality_flag ON posts (quality_flag, created_at DESC)`,
    // Moderation queue scan: "open reports, newest first".
    `CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, created_at DESC)`,
  ];
  for (const sql of POST_ALTER_INDEXES) {
    await client.execute(sql);
    console.log("OK:", sql);
  }

  const tables = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
  );
  console.log("\nPlatform DB tables:", tables.rows.map((r) => r.name).join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
