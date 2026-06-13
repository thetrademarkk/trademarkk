import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { platformDb } from "./db/platform";
import { blogSubmissions, profiles } from "./db/platform-schema";
import { POSTS, readingTime, type Post } from "@/content/posts";

export interface BlogListItem {
  slug: string;
  title: string;
  description: string;
  date: string;
  minutes: number;
  authorName: string | null;
  source: "editorial" | "community";
}

export interface BlogArticle {
  slug: string;
  title: string;
  description: string;
  date: string;
  minutes: number;
  authorName: string | null;
  source: "editorial" | "community";
  /** Editorial posts use structured sections; community posts use sanitized HTML. */
  sections?: Post["sections"];
  intro?: string;
  html?: string;
}

const editorialItem = (p: Post): BlogListItem => ({
  slug: p.slug,
  title: p.title,
  description: p.description,
  date: p.date,
  minutes: readingTime(p),
  authorName: "TradeMarkk",
  source: "editorial",
});

/** All published posts: editorial (static) + approved community submissions. */
export async function listBlogPosts(): Promise<BlogListItem[]> {
  try {
    const approved = await platformDb
      .select()
      .from(blogSubmissions)
      .where(eq(blogSubmissions.status, "approved"))
      .orderBy(desc(blogSubmissions.reviewedAt));

    const handles = approved.length ? await platformDb.select().from(profiles) : [];
    const handleMap = new Map(handles.map((h) => [h.userId, h.displayName]));

    const community: BlogListItem[] = approved.map((a) => ({
      slug: a.slug,
      title: a.title,
      description: a.excerpt,
      date: a.reviewedAt ?? a.createdAt,
      minutes: Math.max(
        1,
        Math.round(a.contentHtml.replace(/<[^>]+>/g, " ").split(/\s+/).length / 200)
      ),
      authorName: handleMap.get(a.authorId) ?? "Community",
      source: "community",
    }));
    return [...POSTS.map(editorialItem), ...community].sort((a, b) => (a.date < b.date ? 1 : -1));
  } catch (e) {
    // Platform DB unreachable (e.g. CI build with placeholder creds) → editorial only.
    console.warn("[blog] DB unavailable, serving editorial posts only", e);
    return POSTS.map(editorialItem);
  }
}

export async function getBlogArticle(slug: string): Promise<BlogArticle | null> {
  const editorial = POSTS.find((p) => p.slug === slug);
  if (editorial) {
    return {
      slug,
      title: editorial.title,
      description: editorial.description,
      date: editorial.date,
      minutes: readingTime(editorial),
      authorName: "TradeMarkk",
      source: "editorial",
      sections: editorial.sections,
      intro: editorial.intro,
    };
  }
  let row, author;
  try {
    row = await platformDb
      .select()
      .from(blogSubmissions)
      .where(and(eq(blogSubmissions.slug, slug), eq(blogSubmissions.status, "approved")))
      .get();
    if (!row) return null;
    author = await platformDb
      .select()
      .from(profiles)
      .where(eq(profiles.userId, row.authorId))
      .get();
  } catch {
    return null;
  }
  return {
    slug,
    title: row.title,
    description: row.excerpt,
    date: row.reviewedAt ?? row.createdAt,
    minutes: Math.max(
      1,
      Math.round(row.contentHtml.replace(/<[^>]+>/g, " ").split(/\s+/).length / 200)
    ),
    authorName: author?.displayName ?? "Community",
    source: "community",
    html: row.contentHtml,
  };
}

export function editorialSlugs(): string[] {
  return POSTS.map((p) => p.slug);
}
