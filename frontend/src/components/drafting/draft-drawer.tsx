"use client"

import { useState } from "react"
import Link from "next/link"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Sparkles, Search, Send, Trash2, Loader2 } from "lucide-react"
import { StageBadge } from "@/components/pipeline/stage-badge"
import { EmailEditor } from "./email-editor"
import { AttachmentPicker, type AttachmentFile } from "./attachment-picker"
import { ContactEmails } from "./contact-emails"
import { createClient } from "@/lib/supabase/client"
import * as Sentry from "@sentry/nextjs"

interface ContactContext {
  contactName: string
  contactTitle: string | null
  contactEmail: string | null
  accountName: string
  stageName: string
  opportunityId: string
  contactId: string
  repEmail: string
}

interface DraftDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  contact: ContactContext | null
}

export function DraftDrawer({ open, onOpenChange, contact }: DraftDrawerProps) {
  const [generating, setGenerating] = useState(false)
  const [generatingMode, setGeneratingMode] = useState<"standard" | "enhanced" | null>(null)
  const [creatingDraft, setCreatingDraft] = useState(false)
  const [editorContent, setEditorContent] = useState("")
  const [subjectLine, setSubjectLine] = useState("")
  const [toField, setToField] = useState("")
  const [ccField, setCcField] = useState("")
  const [bccField, setBccField] = useState("")
  const [showCcBcc, setShowCcBcc] = useState(false)
  const [attachments, setAttachments] = useState<AttachmentFile[]>([])
  const [hasGenerated, setHasGenerated] = useState(false)
  const [draftCreated, setDraftCreated] = useState(false)
  const [hasStyleGuide, setHasStyleGuide] = useState<boolean | null>(null)

  function resetState() {
    setEditorContent("")
    setSubjectLine("")
    setCcField("")
    setBccField("")
    setShowCcBcc(false)
    setAttachments([])
    setHasGenerated(false)
    setDraftCreated(false)
    setToField(contact?.contactEmail ?? "")
    // Probe whether the rep has a style guide; session JWT satisfies the
    // `to authenticated` RLS policy on rep_style_guides.
    setHasStyleGuide(null)
    if (contact?.repEmail) {
      const supabase = createClient()
      supabase
        .from("rep_style_guides")
        .select("rep_email")
        .eq("rep_email", contact.repEmail)
        .maybeSingle()
        .then(({ data }) => setHasStyleGuide(!!data))
    }
  }

  function handleOpenChange(isOpen: boolean) {
    if (isOpen && contact) {
      resetState()
    }
    onOpenChange(isOpen)
  }

  async function handleGenerate(mode: "standard" | "enhanced") {
    if (!contact) return
    setGenerating(true)
    setGeneratingMode(mode)

    try {
      await Sentry.startSpan({ name: "draft.generate", op: "ai.run" }, async () => {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-draft`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contactId: contact.contactId,
              opportunityId: contact.opportunityId,
              mode,
              context: { trigger: "rep_initiated" },
            }),
          }
        )

        if (!response.ok) {
          const text = await response.text()
          throw new Error(`Generation failed: ${response.status} ${text}`)
        }

        const data = await response.json()
        setSubjectLine(data.subject)
        setEditorContent(data.htmlBody)
        setToField(contact.contactEmail ?? "")
        setHasGenerated(true)
      })
    } catch (err) {
      Sentry.captureException(err)
      alert(err instanceof Error ? err.message : "Draft generation failed")
    } finally {
      setGenerating(false)
      setGeneratingMode(null)
    }
  }

  async function handleCreateDraft() {
    if (!contact) return
    setCreatingDraft(true)

    try {
      await Sentry.startSpan({ name: "draft.createGmail", op: "http.client" }, async () => {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-gmail-draft`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              repEmail: contact.repEmail,
              to: toField,
              cc: ccField ? ccField.split(",").map((e) => e.trim()) : undefined,
              bcc: bccField ? bccField.split(",").map((e) => e.trim()) : undefined,
              subject: subjectLine,
              htmlBody: editorContent,
              contactId: contact.contactId,
              opportunityId: contact.opportunityId,
              attachments: attachments.length > 0
                ? attachments.map((a) => ({ storageKey: a.storageKey, filename: a.filename }))
                : undefined,
            }),
          }
        )

        if (!response.ok) {
          const text = await response.text()
          throw new Error(`Draft creation failed: ${response.status} ${text}`)
        }

        setDraftCreated(true)
      })
    } catch (err) {
      Sentry.captureException(err)
      alert(err instanceof Error ? err.message : "Gmail draft creation failed")
    } finally {
      setCreatingDraft(false)
    }
  }

  function handleDiscard() {
    resetState()
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-lg">Draft Email</SheetTitle>
        </SheetHeader>
        {contact && (
          <div className="mt-4 space-y-4">
            {/* Contact context card */}
            <div className="rounded-lg bg-kc-warm-gray p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-kc-charcoal">{contact.contactName}</p>
                  <p className="text-xs text-kc-text-muted">
                    {contact.accountName}
                    {contact.contactTitle && ` · ${contact.contactTitle}`}
                  </p>
                </div>
                <StageBadge stage={contact.stageName} />
              </div>
            </div>

            {/* Contact email history */}
            <ContactEmails
              repEmail={contact.repEmail}
              contactEmail={contact.contactEmail}
            />

            {/* Style guide gate */}
            {hasStyleGuide === false && !generating && (
              <Card className="border-kc-gold/30 bg-kc-gold-subtle/20">
                <CardContent className="p-4 text-center">
                  <p className="text-sm font-medium text-kc-charcoal">
                    Set up your writing style first
                  </p>
                  <p className="mt-1 text-xs text-kc-text-muted">
                    Before generating drafts, Claude needs to learn your writing style. This takes about 30 seconds.
                  </p>
                  <Link href="/settings">
                    <Button className="mt-3 gap-2 bg-kc-gold text-kc-charcoal hover:bg-kc-gold-dark">
                      <Sparkles className="h-4 w-4" />
                      Build My Style Guide
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            )}

            {/* Generate buttons — shown before first generation */}
            {!hasGenerated && !generating && hasStyleGuide && (
              <div className="flex gap-2">
                <Button
                  onClick={() => handleGenerate("standard")}
                  className="flex-1 gap-2 bg-kc-gold text-kc-charcoal hover:bg-kc-gold-dark"
                >
                  <Sparkles className="h-4 w-4" />
                  Generate Draft
                </Button>
                <Button
                  onClick={() => handleGenerate("enhanced")}
                  variant="outline"
                  className="flex-1 gap-2 border-kc-gold/50 text-kc-charcoal hover:bg-kc-gold/10"
                >
                  <Search className="h-4 w-4" />
                  Enhanced Draft
                </Button>
              </div>
            )}

            {/* Loading state */}
            {generating && (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="h-6 w-6 animate-spin text-kc-gold" />
                <p className="text-sm text-kc-text-muted">
                  {generatingMode === "enhanced"
                    ? "Researching & drafting..."
                    : "Generating draft..."}
                </p>
              </div>
            )}

            {/* Draft created success */}
            {draftCreated && (
              <div className="rounded-lg bg-kc-success/10 p-4 text-center">
                <p className="text-sm font-medium text-kc-success">
                  Gmail draft created successfully
                </p>
                <p className="mt-1 text-xs text-kc-text-muted">
                  Check your Gmail drafts folder
                </p>
              </div>
            )}

            {/* Email compose form — shown after generation */}
            {hasGenerated && !draftCreated && (
              <>
                <Separator />

                {/* To field */}
                <div>
                  <div className="flex items-center gap-2">
                    <label className="w-8 text-xs text-kc-text-muted">To</label>
                    <Input
                      type="email"
                      value={toField}
                      onChange={(e) => setToField(e.target.value)}
                      className="flex-1 border-0 border-b border-kc-warm-gray-dark bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                    />
                    {!showCcBcc && (
                      <button
                        onClick={() => setShowCcBcc(true)}
                        className="text-xs text-kc-text-muted hover:text-kc-charcoal"
                      >
                        Cc Bcc
                      </button>
                    )}
                  </div>
                </div>

                {/* Cc / Bcc fields */}
                {showCcBcc && (
                  <>
                    <div className="flex items-center gap-2">
                      <label className="w-8 text-xs text-kc-text-muted">Cc</label>
                      <Input
                        type="text"
                        placeholder="Separate multiple with commas"
                        value={ccField}
                        onChange={(e) => setCcField(e.target.value)}
                        className="flex-1 border-0 border-b border-kc-warm-gray-dark bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="w-8 text-xs text-kc-text-muted">Bcc</label>
                      <Input
                        type="text"
                        placeholder="Separate multiple with commas"
                        value={bccField}
                        onChange={(e) => setBccField(e.target.value)}
                        className="flex-1 border-0 border-b border-kc-warm-gray-dark bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                      />
                    </div>
                  </>
                )}

                {/* Subject line */}
                <div className="flex items-center gap-2">
                  <label className="w-8 text-xs text-kc-text-muted">Subj</label>
                  <Input
                    type="text"
                    value={subjectLine}
                    onChange={(e) => setSubjectLine(e.target.value)}
                    className="flex-1 border-0 border-b border-kc-warm-gray-dark bg-transparent px-0 text-sm font-medium shadow-none focus-visible:ring-0"
                  />
                </div>

                <Separator />

                {/* Rich text editor */}
                <EmailEditor content={editorContent} onChange={setEditorContent} />

                {/* Attachment picker */}
                <AttachmentPicker
                  attachments={attachments}
                  onAttachmentsChange={setAttachments}
                />

                <Separator />

                {/* Regenerate buttons */}
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleGenerate("standard")}
                    variant="outline"
                    size="sm"
                    disabled={generating}
                    className="gap-1.5 text-xs"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Regenerate
                  </Button>
                  <Button
                    onClick={() => handleGenerate("enhanced")}
                    variant="outline"
                    size="sm"
                    disabled={generating}
                    className="gap-1.5 text-xs"
                  >
                    <Search className="h-3.5 w-3.5" />
                    Regenerate Enhanced
                  </Button>
                </div>

                {/* Action bar */}
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={handleCreateDraft}
                    disabled={creatingDraft || !toField || !subjectLine}
                    className="flex-1 gap-2 bg-kc-gold text-kc-charcoal hover:bg-kc-gold-dark"
                  >
                    {creatingDraft ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Create Gmail Draft
                  </Button>
                  <Button
                    onClick={handleDiscard}
                    variant="ghost"
                    className="gap-2 text-kc-text-muted hover:text-kc-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
