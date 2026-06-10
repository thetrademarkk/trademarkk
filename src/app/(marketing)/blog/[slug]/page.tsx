import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Clock } from "lucide-react";
import { POSTS, readingTime } from "@/content/posts";
import { siteConfig, jsonLdScript } from "@/config/site";
import { cn } from "@/lib/utils";
import { Toc } from "../_components/toc";
import { ReadingProgress } from "../_components/progress-bar";

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

  const date = new Date(post.date).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 md:py-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <ReadingProgress />

      <div className="grid gap-10 lg:grid-cols-[190px_minmax(0,1fr)] xl:grid-cols-[190px_minmax(0,1fr)_190px]">
        {/* ── Left rail: all articles ── */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 space-y-3">
            <Link href="/blog" className="flex items-center gap-1.5 text-xs text-muted hover:text-accent">
              <ArrowLeft className="h-3.5 w-3.5" /> All articles
            </Link>
            <p className="micro-label pt-2">Articles</p>
            <ul className="space-y-1">
              {POSTS.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/blog/${p.slug}`}
                    className={cn(
                      "block rounded-md px-2 py-1.5 text-[13px] leading-5 transition-colors",
                      p.slug === post.slug
                        ? "bg-accent/10 text-accent font-medium"
                        : "text-muted hover:bg-surface-2 hover:text-foreground"
                    )}
                  >
                    {p.title.length > 60 ? p.title.slice(0, 57) + "…" : p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* ── Article ── */}
        <article className="min-w-0">
          <Link href="/blog" className="text-xs text-accent hover:underline lg:hidden">
            ← All articles
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted lg:mt-0">
            <time dateTime={post.date}>{date}</time>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" /> {readingTime(post)} min read
            </span>
          </div>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight md:text-4xl">{post.title}</h1>
          <p className="mt-4 border-l-2 border-accent pl-4 text-base leading-7 text-muted">{post.intro}</p>

          {/* Mobile TOC */}
          <details className="mt-6 rounded-lg border bg-surface px-4 py-3 xl:hidden">
            <summary className="text-sm font-medium">On this page</summary>
            <ul className="mt-2 space-y-1.5">
              {post.sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-sm text-muted hover:text-accent">
                    {s.heading}
                  </a>
                </li>
              ))}
            </ul>
          </details>

          <div className="mt-8 space-y-10">
            {post.sections.map((s) => (
              <section key={s.id}>
                <h2 id={s.id} className="group scroll-mt-24 text-xl font-semibold tracking-tight">
                  <a href={`#${s.id}`} className="hover:text-accent">
                    {s.heading}
                  </a>
                </h2>
                <div className="mt-3 space-y-4">
                  {s.paragraphs.map((p, i) => (
                    <p key={i} className="text-[15px] leading-7 text-foreground/90">
                      {p}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="mt-12 rounded-xl border bg-surface p-6 text-center">
            <p className="text-sm font-semibold">Put this into practice — free &amp; open source</p>
            <p className="mt-1 text-xs text-muted">Log trades in 15 seconds. Price your broken rules. Review weekly.</p>
            <Link
              href="/app/onboarding"
              className="mt-4 inline-block rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg hover:opacity-90"
            >
              Open TradeMark
            </Link>
          </div>
        </article>

        {/* ── Right rail: scroll-spy TOC ── */}
        <aside className="hidden xl:block">
          <div className="sticky top-20">
            <Toc items={post.sections.map((s) => ({ id: s.id, heading: s.heading }))} />
          </div>
        </aside>
      </div>
    </div>
  );
}
