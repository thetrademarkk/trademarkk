import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Clock } from "lucide-react";
import { POSTS, readingTime } from "@/content/posts";

export const metadata: Metadata = {
  title: "Blog — trading discipline, journaling & FnO insights",
  description: "Guides on trading journaling, discipline and risk for Indian intraday & FnO traders.",
  alternates: { canonical: "/blog" },
};

export default function BlogIndex() {
  const posts = [...POSTS].sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 md:py-14">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">Blog</h1>
        <p className="mt-2 text-sm text-muted">
          Trading discipline, journaling and FnO insights — written for Indian intraday traders.
        </p>
      </div>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {posts.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="group flex h-full flex-col rounded-xl border bg-surface p-6 transition-all hover:border-accent/60 hover:shadow-lg hover:shadow-accent/5"
          >
            <div className="flex items-center gap-3 text-xs text-muted">
              <time dateTime={post.date}>
                {new Date(post.date).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
              </time>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> {readingTime(post)} min
              </span>
            </div>
            <h2 className="mt-3 text-lg font-semibold leading-snug group-hover:text-accent transition-colors">
              {post.title}
            </h2>
            <p className="mt-2 flex-1 text-sm leading-6 text-muted">{post.description}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent">
              Read article
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
