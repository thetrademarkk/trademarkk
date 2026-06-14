import { cn } from "@/lib/utils";

/**
 * Read-only renderer for stored TipTap HTML — and the single source of truth
 * for the prose styling vocabulary.
 *
 * This module deliberately imports NOTHING from TipTap/ProseMirror and is not a
 * client component: the public, ISR blog article route ([slug]) only needs to
 * paint already-sanitized HTML, so it must not pull the ~editor bundle. The
 * heavy `RichEditor` (and the whole @tiptap stack) lives in `rich-editor.tsx`,
 * which re-exports PROSE_CLASS from here so there is exactly one definition.
 */
export const PROSE_CLASS =
  "prose-tm max-w-none [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:text-lg [&_h3]:font-semibold [&_p]:my-2.5 [&_p]:leading-7 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-4 [&_blockquote]:text-muted [&_a]:text-accent [&_a]:underline [&_img]:rounded-lg [&_img]:border [&_pre]:rounded-lg [&_pre]:bg-surface-2 [&_pre]:p-3 [&_pre]:text-sm [&_code]:font-mono [&_strong]:font-semibold";

/** Read-only renderer for stored TipTap HTML. */
export function RichContent({ html, className }: { html: string; className?: string }) {
  return <div className={cn(PROSE_CLASS, className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
