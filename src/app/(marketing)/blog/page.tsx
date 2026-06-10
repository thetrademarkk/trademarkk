import Link from "next/link";
import type { Metadata } from "next";
import { POSTS } from "@/content/posts";

export const metadata: Metadata = {
  title: "Blog — trading discipline, journaling & FnO insights",
  description: "Guides on trading journaling, discipline and risk for Indian intraday & FnO traders.",
  alternates: { canonical: "/blog" },
};

export default function BlogIndex() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-14">
      <h1 className="text-3xl font-bold">Blog</h1>
      <p className="mt-2 text-sm text-muted">Trading discipline, journaling and FnO insights.</p>
      <div className="mt-8 space-y-6">
        {POSTS.map((post) => (
          <Link key={post.slug} href={`/blog/${post.slug}`} className="block rounded-lg border p-5 transition-colors hover:border-accent">
            <time className="text-xs text-muted">{new Date(post.date).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</time>
            <h2 className="mt-1 text-lg font-semibold">{post.title}</h2>
            <p className="mt-1 text-sm text-muted">{post.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
