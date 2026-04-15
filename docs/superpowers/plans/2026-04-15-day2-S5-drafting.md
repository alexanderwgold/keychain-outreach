# Stage 5: Email Drafting System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the email drafting UX — a side drawer that opens from any contact row, shows contact context, displays AI-generated draft variants, and includes a TipTap rich text editor. Includes a pop-out button that opens a full composer window with to/cc/bcc fields, subject line, and attachment management.

**Architecture:** The drawer is a client component using shadcn's Sheet. Draft generation calls a placeholder API route (actual Claude integration comes in a later backend stage). The TipTap editor is a controlled client component. The pop-out composer opens a new browser window via `window.open`. Draft state is managed locally in the drawer — no global state needed.

**Tech Stack:** shadcn/ui Sheet, TipTap (@tiptap/react with starter-kit + extensions), Lucide icons, Sentry tracing

**Note:** The AI draft generation endpoint doesn't exist yet. The UI will have a "Generate Drafts" button that shows a loading state and placeholder variants. The actual Claude API call will be wired in during the backend Edge Function stage.

---

## Task 1: TipTap Email Editor Component

**Files:**
- Create: `frontend/src/components/drafting/email-editor.tsx`

A rich text HTML editor for composing/editing email drafts. Toolbar with bold, italic, underline, link, lists, alignment.

- [ ] **Step 1: Create email editor component**

Create `frontend/src/components/drafting/email-editor.tsx`:

```tsx
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
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-kc-warm-gray-dark px-2 py-1.5">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          icon={Bold}
          label="Bold"
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          icon={Italic}
          label="Italic"
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive("underline")}
          icon={UnderlineIcon}
          label="Underline"
        />

        <Separator orientation="vertical" className="mx-1 h-6" />

        <ToolbarButton
          onClick={() => {
            const url = window.prompt("Enter URL:")
            if (url) editor.chain().focus().setLink({ href: url }).run()
          }}
          active={editor.isActive("link")}
          icon={LinkIcon}
          label="Link"
        />

        <Separator orientation="vertical" className="mx-1 h-6" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          icon={List}
          label="Bullet list"
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          icon={ListOrdered}
          label="Numbered list"
        />

        <Separator orientation="vertical" className="mx-1 h-6" />

        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          active={editor.isActive({ textAlign: "left" })}
          icon={AlignLeft}
          label="Align left"
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          active={editor.isActive({ textAlign: "center" })}
          icon={AlignCenter}
          label="Align center"
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          active={editor.isActive({ textAlign: "right" })}
          icon={AlignRight}
          label="Align right"
        />

        <div className="flex-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          active={false}
          icon={Undo}
          label="Undo"
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          active={false}
          icon={Redo}
          label="Redo"
        />
      </div>

      {/* Editor area */}
      <EditorContent editor={editor} />
    </div>
  )
}

function ToolbarButton({
  onClick,
  active,
  icon: Icon,
  label,
}: {
  onClick: () => void
  active: boolean
  icon: React.ComponentType<{ className?: string }>
  label: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={onClick}
      className={cn(
        "h-7 w-7",
        active && "bg-kc-gold/15 text-kc-charcoal"
      )}
      aria-label={label}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add frontend/src/components/drafting/email-editor.tsx frontend/package.json frontend/package-lock.json && git commit -m "feat: add TipTap rich text email editor with formatting toolbar

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Draft Variants Display

**Files:**
- Create: `frontend/src/components/drafting/draft-variants.tsx`

Shows 2-3 AI-generated draft variants as selectable cards. Each has a subject line, preview, and angle label (social proof, data, pain point).

- [ ] **Step 1: Create draft variants component**

Create `frontend/src/components/drafting/draft-variants.tsx`:

```tsx
"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export interface DraftVariant {
  id: string
  subject: string
  body: string
  angle: "social_proof" | "data" | "pain_point"
}

interface DraftVariantsProps {
  variants: DraftVariant[]
  selectedId: string | null
  onSelect: (variant: DraftVariant) => void
}

const ANGLE_LABELS: Record<DraftVariant["angle"], { label: string; color: string }> = {
  social_proof: { label: "Social Proof", color: "bg-kc-success/10 text-kc-success" },
  data: { label: "Data-Led", color: "bg-kc-gold/15 text-kc-gold-dark" },
  pain_point: { label: "Pain Point", color: "bg-kc-danger/10 text-kc-danger" },
}

export function DraftVariants({ variants, selectedId, onSelect }: DraftVariantsProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-kc-text-muted">
        Choose a variant
      </p>
      {variants.map((variant) => {
        const isSelected = variant.id === selectedId
        const angle = ANGLE_LABELS[variant.angle]

        return (
          <Card
            key={variant.id}
            className={cn(
              "cursor-pointer transition-all",
              isSelected
                ? "border-kc-gold bg-kc-gold-subtle/50 ring-1 ring-kc-gold"
                : "border-kc-warm-gray-dark/50 hover:border-kc-gold/30"
            )}
            onClick={() => onSelect(variant)}
          >
            <CardContent className="p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-kc-charcoal truncate">
                  {variant.subject}
                </p>
                <Badge className={cn("shrink-0 text-xs", angle.color)}>
                  {angle.label}
                </Badge>
              </div>
              <p className="mt-1.5 text-xs text-kc-text-muted line-clamp-2">
                {variant.body.replace(/<[^>]+>/g, "").slice(0, 150)}...
              </p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add frontend/src/components/drafting/draft-variants.tsx && git commit -m "feat: add selectable draft variant cards with angle labels

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Draft Drawer (Side Panel)

**Files:**
- Create: `frontend/src/components/drafting/draft-drawer.tsx`

The main drafting UX: opens as a right-side sheet, shows contact context at top, generate button, variant selection, and the TipTap editor below.

- [ ] **Step 1: Create draft drawer**

Create `frontend/src/components/drafting/draft-drawer.tsx`:

```tsx
"use client"

import { useState } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Sparkles,
  Send,
  ExternalLink,
  Search,
  Loader2,
} from "lucide-react"
import { StageBadge } from "@/components/pipeline/stage-badge"
import { EmailEditor } from "./email-editor"
import { DraftVariants, type DraftVariant } from "./draft-variants"
import * as Sentry from "@sentry/nextjs"

interface ContactContext {
  contactName: string
  contactTitle: string | null
  contactEmail: string | null
  accountName: string
  stageName: string
  opportunityId: string
}

interface DraftDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  contact: ContactContext | null
}

// Placeholder variants until AI endpoint is built
const PLACEHOLDER_VARIANTS: DraftVariant[] = [
  {
    id: "1",
    subject: "Quick question about your sourcing workflow",
    body: "<p>Hi {{firstName}},</p><p>I noticed your team has been expanding into new categories. Many companies in your space are using Keychain to streamline their sourcing — I'd love to show you how.</p><p>Would you have 15 minutes this week?</p>",
    angle: "social_proof",
  },
  {
    id: "2",
    subject: "{{company}} + Keychain: the numbers",
    body: "<p>Hi {{firstName}},</p><p>There are over 2,500 manufacturers in your category on Keychain right now, with buyer activity up 40% this quarter. Your competitors are already sourcing here.</p><p>Worth a quick call?</p>",
    angle: "data",
  },
  {
    id: "3",
    subject: "Solving the sourcing bottleneck at {{company}}",
    body: "<p>Hi {{firstName}},</p><p>At this stage in your pipeline, most teams struggle with finding the right manufacturing partners quickly. Keychain cuts that timeline from months to days.</p><p>Can I walk you through a quick demo?</p>",
    angle: "pain_point",
  },
]

export function DraftDrawer({ open, onOpenChange, contact }: DraftDrawerProps) {
  const [generating, setGenerating] = useState(false)
  const [variants, setVariants] = useState<DraftVariant[]>([])
  const [selectedVariant, setSelectedVariant] = useState<DraftVariant | null>(null)
  const [editorContent, setEditorContent] = useState("")
  const [subjectLine, setSubjectLine] = useState("")

  function handleGenerate() {
    if (!contact) return

    Sentry.startSpan({ name: "draft.generate", op: "ai.run" }, () => {
      setGenerating(true)

      // Simulate AI generation delay — replace with real API call
      setTimeout(() => {
        const personalized = PLACEHOLDER_VARIANTS.map((v) => ({
          ...v,
          subject: v.subject
            .replace("{{company}}", contact.accountName)
            .replace("{{firstName}}", contact.contactName.split(" ")[0]),
          body: v.body
            .replace(/\{\{firstName\}\}/g, contact.contactName.split(" ")[0])
            .replace(/\{\{company\}\}/g, contact.accountName),
        }))
        setVariants(personalized)
        setGenerating(false)
      }, 1500)
    })
  }

  function handleSelectVariant(variant: DraftVariant) {
    setSelectedVariant(variant)
    setSubjectLine(variant.subject)
    setEditorContent(variant.body)
  }

  function handlePopOut() {
    // Open a new window with the draft content
    const popup = window.open("", "_blank", "width=700,height=800,scrollbars=yes")
    if (!popup) return

    popup.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Draft: ${subjectLine}</title>
        <style>
          body { font-family: Inter, system-ui, sans-serif; padding: 24px; color: #2C2C2E; }
          .field { margin-bottom: 12px; }
          .field label { display: block; font-size: 12px; font-weight: 600; color: #8E8E93; margin-bottom: 4px; }
          .field input { width: 100%; padding: 8px; border: 1px solid #E0DDD8; border-radius: 6px; font-size: 14px; }
          .editor { border: 1px solid #E0DDD8; border-radius: 6px; padding: 16px; min-height: 300px; font-size: 14px; line-height: 1.6; }
          .btn { padding: 8px 16px; background: #F5C518; color: #1C1C1E; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; margin-top: 16px; }
        </style>
      </head>
      <body>
        <div class="field">
          <label>To</label>
          <input type="text" value="${contact?.contactEmail ?? ""}" />
        </div>
        <div class="field">
          <label>Subject</label>
          <input type="text" value="${subjectLine}" />
        </div>
        <div class="editor" contenteditable="true">${editorContent}</div>
        <button class="btn">Create Gmail Draft</button>
      </body>
      </html>
    `)
    popup.document.close()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-lg">Draft Email</SheetTitle>
        </SheetHeader>

        {contact && (
          <div className="mt-4 space-y-6">
            {/* Contact context */}
            <div className="rounded-lg bg-kc-warm-gray p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-kc-charcoal">
                    {contact.contactName}
                  </p>
                  <p className="text-xs text-kc-text-muted">
                    {contact.accountName}
                    {contact.contactTitle && ` · ${contact.contactTitle}`}
                  </p>
                  {contact.contactEmail && (
                    <p className="mt-1 text-xs text-kc-text-muted">
                      {contact.contactEmail}
                    </p>
                  )}
                </div>
                <StageBadge stage={contact.stageName} />
              </div>
            </div>

            {/* Generate button */}
            {variants.length === 0 && (
              <Button
                onClick={handleGenerate}
                disabled={generating}
                className="w-full gap-2 bg-kc-gold text-kc-charcoal hover:bg-kc-gold-dark"
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating drafts...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate Drafts
                  </>
                )}
              </Button>
            )}

            {/* Loading skeleton */}
            {generating && (
              <div className="space-y-2">
                <Skeleton className="h-20 rounded-lg" />
                <Skeleton className="h-20 rounded-lg" />
                <Skeleton className="h-20 rounded-lg" />
              </div>
            )}

            {/* Variants */}
            {!generating && variants.length > 0 && (
              <>
                <DraftVariants
                  variants={variants}
                  selectedId={selectedVariant?.id ?? null}
                  onSelect={handleSelectVariant}
                />

                <Separator />

                {/* Enhance with Research button */}
                {selectedVariant && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2 border-kc-gold/50 text-kc-charcoal hover:bg-kc-gold/10"
                  >
                    <Search className="h-3.5 w-3.5" />
                    Enhance with Research
                  </Button>
                )}

                {/* Subject line */}
                {selectedVariant && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-kc-text-muted">
                      Subject
                    </label>
                    <input
                      type="text"
                      value={subjectLine}
                      onChange={(e) => setSubjectLine(e.target.value)}
                      className="w-full rounded-lg border border-kc-warm-gray-dark bg-white px-3 py-2 text-sm focus:border-kc-gold focus:outline-none focus:ring-1 focus:ring-kc-gold"
                    />
                  </div>
                )}

                {/* Editor */}
                {selectedVariant && (
                  <EmailEditor
                    content={editorContent}
                    onChange={setEditorContent}
                    placeholder="Select a variant above to start editing..."
                  />
                )}

                {/* Action buttons */}
                {selectedVariant && (
                  <div className="flex gap-2">
                    <Button
                      className="flex-1 gap-2 bg-kc-gold text-kc-charcoal hover:bg-kc-gold-dark"
                    >
                      <Send className="h-4 w-4" />
                      Create Gmail Draft
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handlePopOut}
                      className="gap-2"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Pop Out
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add frontend/src/components/drafting/draft-drawer.tsx && git commit -m "feat: add draft drawer with contact context, AI variants, editor, and pop-out

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire Draft Button into Dashboard & Pipeline

**Files:**
- Create: `frontend/src/components/drafting/draft-trigger.tsx` — wrapper that manages drawer state
- Modify: `frontend/src/components/dashboard/overdue-contacts-list.tsx` — wire Draft button
- Modify: `frontend/src/components/pipeline/pipeline-table.tsx` — wire Draft button

- [ ] **Step 1: Create draft trigger wrapper**

Create `frontend/src/components/drafting/draft-trigger.tsx`:

```tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Mail } from "lucide-react"
import { DraftDrawer } from "./draft-drawer"

interface DraftTriggerProps {
  contactName: string
  contactTitle: string | null
  contactEmail: string | null
  accountName: string
  stageName: string
  opportunityId: string
  size?: "sm" | "default"
  variant?: "outline" | "ghost"
  className?: string
}

export function DraftTrigger({
  contactName,
  contactTitle,
  contactEmail,
  accountName,
  stageName,
  opportunityId,
  size = "sm",
  variant = "outline",
  className,
}: DraftTriggerProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        size={size}
        variant={variant}
        className={className}
        onClick={() => setOpen(true)}
      >
        <Mail className="h-3.5 w-3.5" />
        Draft
      </Button>
      <DraftDrawer
        open={open}
        onOpenChange={setOpen}
        contact={{
          contactName,
          contactTitle,
          contactEmail,
          accountName,
          stageName,
          opportunityId,
        }}
      />
    </>
  )
}
```

- [ ] **Step 2: Update overdue contacts list to use DraftTrigger**

In `frontend/src/components/dashboard/overdue-contacts-list.tsx`, replace the static `<Button>` with `<DraftTrigger>`. The component needs to become a client component (`"use client"`) since `DraftTrigger` manages state.

Replace the existing static Draft button in each contact row with:
```tsx
<DraftTrigger
  contactName={`${item.contact.first_name} ${item.contact.last_name}`}
  contactTitle={item.contact.title}
  contactEmail={item.contact.email}
  accountName={item.opportunity.account_name}
  stageName={item.opportunity.stage_name}
  opportunityId={item.opportunity.id}
  size="sm"
  variant="outline"
  className="shrink-0 gap-1.5 border-kc-gold/50 text-kc-charcoal hover:bg-kc-gold/10"
/>
```

- [ ] **Step 3: Update pipeline table to use DraftTrigger**

In `frontend/src/components/pipeline/pipeline-table.tsx`, replace the static Draft button with `<DraftTrigger>`. The component needs `"use client"`.

Replace the ghost Draft button with:
```tsx
<DraftTrigger
  contactName={row.contactName}
  contactTitle={row.contactTitle}
  contactEmail={row.contactEmail}
  accountName={row.accountName}
  stageName={row.stageName}
  opportunityId={row.opportunityId}
  size="sm"
  variant="ghost"
  className="gap-1.5 opacity-0 transition-opacity group-hover:opacity-100"
/>
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach/frontend && npm run build 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add frontend/src/components/drafting/draft-trigger.tsx frontend/src/components/dashboard/overdue-contacts-list.tsx frontend/src/components/pipeline/pipeline-table.tsx && git commit -m "feat: wire draft drawer into dashboard and pipeline via DraftTrigger

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Stage 5 Completion Checklist

- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] "Draft" button on dashboard contact rows opens the side drawer
- [ ] "Draft" button on pipeline table rows opens the side drawer
- [ ] Drawer shows contact context (name, company, title, email, stage badge)
- [ ] "Generate Drafts" button triggers loading state with skeletons
- [ ] 3 variant cards appear after generation (Social Proof, Data-Led, Pain Point)
- [ ] Selecting a variant populates the subject line and editor
- [ ] TipTap editor has working toolbar (bold, italic, underline, link, lists, alignment)
- [ ] "Enhance with Research" button renders (placeholder action)
- [ ] "Pop Out" button opens a new browser window with the draft
- [ ] "Create Gmail Draft" button renders (placeholder action)
- [ ] All draft generation wrapped in `Sentry.startSpan`
