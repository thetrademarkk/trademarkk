import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Clock } from "lucide-react";
import { getBlogArticle, listBlogPosts } from "@/server/blog-posts";
import { siteConfig, jsonLdScript } from "@/config/site";
import { RichContent } from "@/components/ui/rich-editor";
import { cn } from "@/lib/utils";
import { Toc } from "../_components/toc";
import { ReadingProgress } from "../_components/progress-bar";

export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogArticle(slug);
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
  const [post, allPosts] = await Promise.all([getBlogArticle(slug), listBlogPosts()]);
  if (!post) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    author: { "@type": post.source === "community" ? "Person" : "Organization", name: post.authorName ?? siteConfig.name },
    publisher: { "@type": "Organization", name: siteConfig.name },
    mainEntityOfPage: `${siteConfig.url}/blog/${post.slug}`,
  };
  const date = new Date(post.date).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const hasToc = post.source === "editorial" && post.sections && post.sections.length > 1;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 md:py-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <ReadingProgress />

      <div className="grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)_190px]">
        {/* ── Left rail: all articles, current highlighted ── */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 space-y-3">
            <Link href="/blog" className="flex items-center gap-1.5 text-xs text-muted hover:text-accent">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All articles
            </Link>
            <p className="micro-label pt-2">Articles</p>
            <ul className="space-y-1">
              {allPosts.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/blog/${p.slug}`}
                    aria-current={p.slug === post.slug ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-2 py-1.5 text-[13px] leading-5 transition-colors",
                      p.slug === post.slug
                        ? "bg-accent/10 font-medium text-accent"
                        : "text-muted hover:bg-surface-2 hover:text-foreground"
                    )}
                  >
                    {p.title.length > 58 ? p.title.slice(0, 55) + "…" : p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <article className="mx-auto w-full max-w-2xl">
          <Link
            href="/blog"
            className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline lg:hidden"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All articles
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
            <time dateTime={post.date}>{date}</time>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" aria-hidden /> {post.minutes} min read
            </span>
            {post.authorName && <span>· by {post.authorName}</span>}
            {post.source === "community" && (
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">Community</span>
            )}
          </div>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight md:text-4xl">{post.title}</h1>

          {post.source === "editorial" && post.intro && (
            <p className="mt-4 border-l-2 border-accent pl-4 text-base leading-7 text-muted">{post.intro}</p>
          )}

          {post.source === "editorial" && post.sections ? (
            <div className="mt-8 space-y-10">
              {post.sections.map((s) => (
                <section key={s.id}>
                  <h2 id={s.id} className="scroll-mt-24 text-xl font-semibold tracking-tight">
                    <a href={`#${s.id}`} className="hover:text-accent">{s.heading}</a>
                  </h2>
                  <div className="mt-3 space-y-4">
                    {s.paragraphs.map((p, i) => (
                      <p key={i} className="text-[15px] leading-7 text-foreground/90">{p}</p>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <RichContent html={post.html ?? ""} className="mt-8 text-[15px]" />
          )}

          <div className="mt-12 rounded-xl border bg-surface p-6 text-center">
            <p className="text-sm font-semibold">Put this into practice — free &amp; open source</p>
            <Link
              href="/app/onboarding"
              className="mt-4 inline-block rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg hover:opacity-90"
            >
              Open TradeMark
            </Link>
          </div>
        </article>

        {hasToc && (
          <aside className="hidden xl:block">
            <div className="sticky top-20">
              <Toc items={post.sections!.map((s) => ({ id: s.id, heading: s.heading }))} />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
