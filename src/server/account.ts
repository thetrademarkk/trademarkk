import "server-only";
import { sql } from "drizzle-orm";
import { platformDb } from "./db/platform";

/**
 * Removes every trace of a user from the platform DB before the auth rows go.
 * SQLite FK cascades are not enforced over libsql HTTP (PRAGMA foreign_keys is
 * per-connection), so account deletion must purge explicitly — otherwise the
 * user's posts, comments, profile and social graph would outlive the account.
 * Feedback and page-view analytics are anonymized rather than deleted (they
 * may be anonymous already by design).
 */
export async function purgeUserContent(userId: string) {
  // Likes the user gave on other people's content — keep counters honest.
  await platformDb.run(
    sql`UPDATE posts SET like_count = MAX(0, like_count - 1)
        WHERE id IN (SELECT post_id FROM likes WHERE user_id = ${userId})`
  );
  await platformDb.run(sql`DELETE FROM likes WHERE user_id = ${userId}`);
  await platformDb.run(
    sql`UPDATE comments SET like_count = MAX(0, like_count - 1)
        WHERE id IN (SELECT comment_id FROM comment_likes WHERE user_id = ${userId})`
  );
  await platformDb.run(sql`DELETE FROM comment_likes WHERE user_id = ${userId}`);

  // Their posts, with everything hanging off them (comments by anyone, likes,
  // bookmarks, images).
  await platformDb.run(
    sql`DELETE FROM comment_likes WHERE comment_id IN (
          SELECT id FROM comments WHERE post_id IN (SELECT id FROM posts WHERE user_id = ${userId}))`
  );
  await platformDb.run(
    sql`DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE user_id = ${userId})`
  );
  await platformDb.run(
    sql`DELETE FROM likes WHERE post_id IN (SELECT id FROM posts WHERE user_id = ${userId})`
  );
  await platformDb.run(
    sql`DELETE FROM bookmarks WHERE post_id IN (SELECT id FROM posts WHERE user_id = ${userId})`
  );
  await platformDb.run(
    sql`DELETE FROM post_images WHERE post_id IN (SELECT id FROM posts WHERE user_id = ${userId})`
  );
  await platformDb.run(sql`DELETE FROM posts WHERE user_id = ${userId}`);

  // Their comments on other people's posts (plus replies threaded under their
  // top-level comments), then recompute affected posts' comment counts exactly.
  const affected = await platformDb.all<{ postId: string }>(
    sql`SELECT DISTINCT post_id AS postId FROM comments
        WHERE user_id = ${userId}
           OR parent_id IN (SELECT id FROM comments WHERE user_id = ${userId})`
  );
  await platformDb.run(
    sql`DELETE FROM comment_likes WHERE comment_id IN (
          SELECT id FROM comments WHERE user_id = ${userId}
             OR parent_id IN (SELECT id FROM comments WHERE user_id = ${userId}))`
  );
  await platformDb.run(
    sql`DELETE FROM comments WHERE user_id = ${userId}
           OR parent_id IN (SELECT id FROM comments WHERE user_id = ${userId})`
  );
  for (const row of affected) {
    await platformDb.run(
      sql`UPDATE posts SET comment_count =
            (SELECT COUNT(*) FROM comments WHERE post_id = ${row.postId})
          WHERE id = ${row.postId}`
    );
  }

  // Social graph, notifications (sent and received), reports, authored blog posts.
  await platformDb.run(sql`DELETE FROM bookmarks WHERE user_id = ${userId}`);
  await platformDb.run(
    sql`DELETE FROM follows WHERE follower_id = ${userId} OR following_id = ${userId}`
  );
  await platformDb.run(
    sql`DELETE FROM blocks WHERE blocker_id = ${userId} OR blocked_id = ${userId}`
  );
  await platformDb.run(
    sql`DELETE FROM notifications WHERE user_id = ${userId} OR actor_id = ${userId}`
  );
  await platformDb.run(sql`DELETE FROM reports WHERE reporter_id = ${userId}`);
  await platformDb.run(sql`DELETE FROM blog_submissions WHERE author_id = ${userId}`);

  // Anonymize rather than delete — feedback/analytics carry no content tied to
  // identity once the user link is gone.
  await platformDb.run(
    sql`UPDATE feedback SET user_id = NULL, email = NULL WHERE user_id = ${userId}`
  );
  await platformDb.run(sql`UPDATE page_events SET user_id = NULL WHERE user_id = ${userId}`);

  await platformDb.run(sql`DELETE FROM profiles WHERE user_id = ${userId}`);
}
