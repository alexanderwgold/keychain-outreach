"use client"

import { useState } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Sparkles, Send, ExternalLink, Search, Loader2 } from "lucide-react"
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
      setTimeout(() => {
        const personalized = PLACEHOLDER_VARIANTS.map((v) => ({
          ...v,
          subject: v.subject.replace("{{company}}", contact.accountName).replace("{{firstName}}", contact.contactName.split(" ")[0]),
          body: v.body.replace(/\{\{firstName\}\}/g, contact.contactName.split(" ")[0]).replace(/\{\{company\}\}/g, contact.accountName),
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
    const popup = window.open("", "_blank", "width=700,height=800,scrollbars=yes")
    if (!popup) return
    popup.document.write(`<!DOCTYPE html><html><head><title>Draft: ${subjectLine}</title><style>body{font-family:Inter,system-ui,sans-serif;padding:24px;color:#2C2C2E}.field{margin-bottom:12px}.field label{display:block;font-size:12px;font-weight:600;color:#8E8E93;margin-bottom:4px}.field input{width:100%;padding:8px;border:1px solid #E0DDD8;border-radius:6px;font-size:14px;box-sizing:border-box}.editor{border:1px solid #E0DDD8;border-radius:6px;padding:16px;min-height:300px;font-size:14px;line-height:1.6}.btn{padding:8px 16px;background:#F5C518;color:#1C1C1E;border:none;border-radius:6px;font-weight:600;cursor:pointer;margin-top:16px}</style></head><body><div class="field"><label>To</label><input type="text" value="${contact?.contactEmail ?? ""}"/></div><div class="field"><label>Subject</label><input type="text" value="${subjectLine}"/></div><div class="editor" contenteditable="true">${editorContent}</div><button class="btn">Create Gmail Draft</button></body></html>`)
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
            <div className="rounded-lg bg-kc-warm-gray p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-kc-charcoal">{contact.contactName}</p>
                  <p className="text-xs text-kc-text-muted">{contact.accountName}{contact.contactTitle && ` · ${contact.contactTitle}`}</p>
                  {contact.contactEmail && <p className="mt-1 text-xs text-kc-text-muted">{contact.contactEmail}</p>}
                </div>
                <StageBadge stage={contact.stageName} />
              </div>
            </div>

            {variants.length === 0 && (
              <Button onClick={handleGenerate} disabled={generating} className="w-full gap-2 bg-kc-gold text-kc-charcoal hover:bg-kc-gold-dark">
                {generating ? (<><Loader2 className="h-4 w-4 animate-spin" />Generating drafts...</>) : (<><Sparkles className="h-4 w-4" />Generate Drafts</>)}
              </Button>
            )}

            {generating && (
              <div className="space-y-2">
                <Skeleton className="h-20 rounded-lg" />
                <Skeleton className="h-20 rounded-lg" />
                <Skeleton className="h-20 rounded-lg" />
              </div>
            )}

            {!generating && variants.length > 0 && (
              <>
                <DraftVariants variants={variants} selectedId={selectedVariant?.id ?? null} onSelect={handleSelectVariant} />
                <Separator />
                {selectedVariant && (
                  <Button variant="outline" size="sm" className="w-full gap-2 border-kc-gold/50 text-kc-charcoal hover:bg-kc-gold/10">
                    <Search className="h-3.5 w-3.5" />
                    Enhance with Research
                  </Button>
                )}
                {selectedVariant && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-kc-text-muted">Subject</label>
                    <input type="text" value={subjectLine} onChange={(e) => setSubjectLine(e.target.value)} className="w-full rounded-lg border border-kc-warm-gray-dark bg-white px-3 py-2 text-sm focus:border-kc-gold focus:outline-none focus:ring-1 focus:ring-kc-gold" />
                  </div>
                )}
                {selectedVariant && <EmailEditor content={editorContent} onChange={setEditorContent} />}
                {selectedVariant && (
                  <div className="flex gap-2">
                    <Button className="flex-1 gap-2 bg-kc-gold text-kc-charcoal hover:bg-kc-gold-dark"><Send className="h-4 w-4" />Create Gmail Draft</Button>
                    <Button variant="outline" onClick={handlePopOut} className="gap-2"><ExternalLink className="h-4 w-4" />Pop Out</Button>
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
