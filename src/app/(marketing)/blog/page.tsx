import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Clock, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listBlogPosts } from "@/server/blog-posts";

export const metadata: Metadata = {
  title: "Blog — trading discipline, journaling & FnO insights",
  description:
    "Guides on trading journaling, discipline and risk for Indian intraday & FnO traders.",
  alternates: { canonical: "/blog" },
  // Without this, the page inherits the homepage og:url from the root layout.
  openGraph: { url: "/blog" },
};

// Revalidate hourly; approving a community post revalidates on demand.
export const revalidate = 3600;

export default async function BlogIndex() {
  const posts = await listBlogPosts();
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 md:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight">Blog</h1>
          <p className="mt-2 text-sm text-muted">
            Trading discipline, journaling and FnO insights — from the team and the community.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/blog/write">
            <PenLine className="h-4 w-4" aria-hidden /> Write a post
          </Link>
        </Button>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {posts.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="group flex h-full flex-col rounded-xl border bg-surface p-6 transition-all hover:border-accent/60 hover:shadow-lg hover:shadow-accent/5"
          >
            <div className="flex items-center gap-2 text-xs text-muted">
              <time dateTime={post.date}>
                {new Date(post.date).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </time>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" aria-hidden /> {post.minutes} min
              </span>
              {post.source === "community" && (
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                  Community
                </span>
              )}
            </div>
            <h2 className="mt-3 text-lg font-semibold leading-snug transition-colors group-hover:text-accent">
              {post.title}
            </h2>
            <p className="mt-2 flex-1 text-sm leading-6 text-muted">{post.description}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent">
              Read article
              <ArrowRight
                className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
