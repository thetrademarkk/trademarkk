import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { POSTS } from "@/content/posts";
import { siteConfig, jsonLdScript } from "@/config/site";

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = POSTS.find((p) => p.slug === slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: { type: "article", title: post.title, description: post.description, publishedTime: post.date },
  };
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = POSTS.find((p) => p.slug === slug);
  if (!post) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    author: { "@type": "Organization", name: siteConfig.name },
    publisher: { "@type": "Organization", name: siteConfig.name },
    mainEntityOfPage: `${siteConfig.url}/blog/${post.slug}`,
  };

  return (
    <article className="mx-auto w-full max-w-2xl px-4 py-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <Link href="/blog" className="text-xs text-accent hover:underline">← All posts</Link>
      <h1 className="mt-3 text-3xl font-bold leading-tight">{post.title}</h1>
      <time className="mt-2 block text-xs text-muted">
        {new Date(post.date).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
      </time>
      <div className="mt-6 space-y-4 text-[15px] leading-7 text-foreground/90">
        {post.body.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <div className="mt-10 rounded-lg border bg-surface p-5 text-center">
        <p className="text-sm font-semibold">Start your journal today — free &amp; open source</p>
        <Link href="/app/dashboard" className="mt-2 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg">
          Open TradeMark
        </Link>
      </div>
    </article>
  );
}
