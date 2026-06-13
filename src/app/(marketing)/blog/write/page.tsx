import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { QueryProvider } from "@/providers/query-provider";
import { BlogSubmitForm } from "@/features/blog/components/submit-form";

export const metadata: Metadata = {
  title: "Write a post",
  description:
    "Share your trading lessons with the TradeMarkk community. Posts are reviewed before publishing.",
  robots: { index: false },
};

export default function WriteBlogPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 md:py-14">
      <Link
        href="/blog"
        className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to blog
      </Link>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Write a post</h1>
      <p className="mt-2 text-sm text-muted">
        Share a lesson, a setup, or a hard-won insight. Our team reviews every submission before it
        goes live — keep it educational and original.
      </p>
      <div className="mt-8">
        <QueryProvider>
          <BlogSubmitForm />
        </QueryProvider>
      </div>
    </div>
  );
}
