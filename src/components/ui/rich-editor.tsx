"use client";

import * as React from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";
import { compressImage } from "@/lib/images";
import { cn } from "@/lib/utils";
import { PROSE_CLASS, RichContent } from "@/components/ui/rich-content";

// PROSE_CLASS and the read-only RichContent renderer live in rich-content.tsx
// (no TipTap imports) so the ISR blog article route can render stored HTML
// without bundling this editor. Re-exported here for existing import sites.
export { PROSE_CLASS, RichContent };

/**
 * TipTap rich-text editor — headings, bold/italic/strike, lists, quote, code,
 * links and inline images (auto-compressed). Emits sanitized-ish HTML; the
 * read-only renderer below only renders this controlled vocabulary.
 */
function ToolbarButton({
  onClick,
  active,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-foreground [&_svg]:h-4 [&_svg]:w-4",
        active && "bg-accent/15 text-accent"
      )}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const addImage = async (file: File) => {
    try {
      const data = await compressImage(file);
      editor.chain().focus().setImage({ src: data }).run();
    } catch {
      /* ignore */
    }
  };
  const addLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") editor.chain().focus().unsetLink().run();
    else editor.chain().focus().setLink({ href: url }).run();
  };

  return (
    <div
      className="flex flex-wrap items-center gap-0.5 border-b p-1.5"
      role="toolbar"
      aria-label="Formatting"
    >
      <ToolbarButton
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic />
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton
        label="Heading 2"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 />
      </ToolbarButton>
      <ToolbarButton
        label="Heading 3"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton
        label="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered />
      </ToolbarButton>
      <ToolbarButton
        label="Quote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote />
      </ToolbarButton>
      <ToolbarButton
        label="Code block"
        active={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Code />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton label="Add link" active={editor.isActive("link")} onClick={addLink}>
        <Link2 />
      </ToolbarButton>
      <label className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground">
        <ImageIcon className="h-4 w-4" aria-hidden />
        <span className="sr-only">Insert image</span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && void addImage(e.target.files[0])}
        />
      </label>
      <span className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton label="Undo" onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 />
      </ToolbarButton>
      <ToolbarButton label="Redo" onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 />
      </ToolbarButton>
    </div>
  );
}

export function RichEditor({
  value,
  onChange,
  placeholder = "Write something…",
  minHeight = 200,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer nofollow" },
      }),
      Image.configure({ HTMLAttributes: { loading: "lazy", alt: "" } }),
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: cn(PROSE_CLASS, "px-3 py-3 focus:outline-none"),
        style: `min-height:${minHeight}px`,
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": placeholder,
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  if (!editor)
    return <div className="rounded-lg border" style={{ minHeight: minHeight + 50 }} aria-busy />;

  return (
    <div className="rounded-lg border bg-surface-2/30 focus-within:ring-2 focus-within:ring-accent">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
