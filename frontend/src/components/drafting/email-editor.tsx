"use client"

import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Link from "@tiptap/extension-link"
import Underline from "@tiptap/extension-underline"
import TextAlign from "@tiptap/extension-text-align"
import Placeholder from "@tiptap/extension-placeholder"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Undo,
  Redo,
} from "lucide-react"

interface EmailEditorProps {
  content: string
  onChange: (html: string) => void
  placeholder?: string
  className?: string
}

export function EmailEditor({
  content,
  onChange,
  placeholder = "Write your email...",
  className,
}: EmailEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-blue-600 underline" },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[200px] px-4 py-3",
      },
    },
  })

  if (!editor) return null

  return (
    <div className={cn("rounded-lg border border-kc-warm-gray-dark bg-white", className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-kc-warm-gray-dark px-2 py-1.5">
        <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} icon={Bold} label="Bold" />
        <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} icon={Italic} label="Italic" />
        <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} icon={UnderlineIcon} label="Underline" />
        <Separator orientation="vertical" className="mx-1 h-6" />
        <ToolbarButton onClick={() => { const url = window.prompt("Enter URL:"); if (url) editor.chain().focus().setLink({ href: url }).run() }} active={editor.isActive("link")} icon={LinkIcon} label="Link" />
        <Separator orientation="vertical" className="mx-1 h-6" />
        <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} icon={List} label="Bullet list" />
        <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} icon={ListOrdered} label="Numbered list" />
        <Separator orientation="vertical" className="mx-1 h-6" />
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign("left").run()} active={editor.isActive({ textAlign: "left" })} icon={AlignLeft} label="Align left" />
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign("center").run()} active={editor.isActive({ textAlign: "center" })} icon={AlignCenter} label="Align center" />
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign("right").run()} active={editor.isActive({ textAlign: "right" })} icon={AlignRight} label="Align right" />
        <div className="flex-1" />
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} active={false} icon={Undo} label="Undo" />
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} active={false} icon={Redo} label="Redo" />
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}

function ToolbarButton({ onClick, active, icon: Icon, label }: { onClick: () => void; active: boolean; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <Button type="button" variant="ghost" size="icon-xs" onClick={onClick} className={cn("h-7 w-7", active && "bg-kc-gold/15 text-kc-charcoal")} aria-label={label}>
      <Icon className="h-3.5 w-3.5" />
    </Button>
  )
}
