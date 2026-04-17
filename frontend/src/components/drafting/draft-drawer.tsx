"use client"

import { useEffect, useState } from "react"
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
  // Arsenal-send mode: when contact is null AND these are provided, drawer
  // skips generate/style-guide UI and uses the prefilled body directly.
  prefillBody?: string
  initialTo?: string
  initialSubject?: string
  extraAttachments?: Array<
    | { storageKey: string; filename: string }
    | { driveFileId: string; filename?: string }
  >
}

export function DraftDrawer({ open, onOpenChange, contact, prefillBody, initialTo, initialSubject, extraAttachments }: DraftDrawerProps) {
  const arsenalMode = !contact && !!prefillBody
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
    setCcField("")
    setBccField("")
    setShowCcBcc(false)
    setAttachments([])
    setDraftCreated(false)
    if (arsenalMode) {
      // Arsenal mode: prefill body and recipient; skip generate UI gate
      setEditorContent(prefillBody ?? "")
      setSubjectLine(initialSubject ?? "")
      setToField(initialTo ?? "")
      setHasGenerated(true)
      setHasStyleGuide(null)
    } else {
      // Opportunity flow: unchanged behavior
      setEditorContent("")
      setSubjectLine("")
      setToField(contact?.contactEmail ?? "")
      setHasGenerated(false)
      // Style-guide presence is probed in an effect below so we don't setState
      // after unmount if the drawer closes mid-request.
      setHasStyleGuide(null)
    }
  }

  // Probe whether the rep has a style guide; session JWT satisfies the
  // `to authenticated` RLS policy on rep_style_guides. Keyed on open+repEmail
  // so closing the drawer or switching contacts aborts the pending probe.
  // Not needed in Arsenal mode since we never generate.
  useEffect(() => {
    if (!open || arsenalMode || !contact?.repEmail) return
    let aborted = false
    const supabase = createClient()
    Promise.resolve(
      supabase
        .from("rep_style_guides")
        .select("rep_email")
        .eq("rep_email", contact.repEmail)
        .maybeSingle()
    )
      .then(({ data }) => {
        if (!aborted) setHasStyleGuide(!!data)
      })
      .catch(() => {
        if (!aborted) setHasStyleGuide(false)
      })
    return () => {
      aborted = true
    }
  }, [open, contact?.repEmail, arsenalMode])

  function handleOpenChange(isOpen: boolean) {
    if (isOpen && (contact || arsenalMode)) {
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
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          throw new Error("Please sign in again")
        }
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-draft`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
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
    if (!contact && !arsenalMode) return
    setCreatingDraft(true)

    try {
      await Sentry.startSpan({ name: "draft.createGmail", op: "http.client" }, async () => {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          throw new Error("Please sign in again")
        }

        // In arsenal mode, repEmail comes from the session since there's no contact
        const { data: { user } } = await supabase.auth.getUser()
        const repEmail = contact?.repEmail ?? user?.email
        if (!repEmail) throw new Error("Not signed in")

        const localAttachments = attachments.map((a) => ({ storageKey: a.storageKey, filename: a.filename }))
        const allAttachments = [...localAttachments, ...(extraAttachments ?? [])]

        const payload: Record<string, unknown> = {
          repEmail,
          to: toField,
          cc: ccField
            ? ccField.split(",").map((e) => e.trim()).filter(Boolean)
            : undefined,
          bcc: bccField
            ? bccField.split(",").map((e) => e.trim()).filter(Boolean)
            : undefined,
          subject: subjectLine,
          htmlBody: editorContent,
          attachments: allAttachments.length > 0 ? allAttachments : undefined,
        }

        // Opportunity flow: include contact/opportunity IDs for activity_log
        if (contact) {
          payload.contactId = contact.contactId
          payload.opportunityId = contact.opportunityId
        }

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-gmail-draft`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
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
        {(contact || arsenalMode) && (
          <div className="mt-4 space-y-4">
            {/* Context card — opportunity flow shows contact info; Arsenal shows generic header */}
            {contact ? (
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
            ) : (
              <div className="rounded-lg bg-kc-warm-gray p-3">
                <p className="text-sm font-medium text-kc-charcoal">Send content</p>
                <p className="text-xs text-kc-text-muted">Fill in recipient and subject, then create the draft.</p>
              </div>
            )}

            {/* Contact email history — opportunity flow only */}
            {contact && (
              <ContactEmails
                repEmail={contact.repEmail}
                contactEmail={contact.contactEmail}
              />
            )}

            {/* Style guide gate — opportunity flow only */}
            {!arsenalMode && hasStyleGuide === false && !generating && (
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

            {/* Generate buttons — opportunity flow only, shown before first generation */}
            {!arsenalMode && !hasGenerated && !generating && hasStyleGuide && (
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

            {/* Email compose form — shown after generation (both modes) */}
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

                {/* Regenerate buttons — opportunity flow only */}
                {!arsenalMode && (
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
                )}

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
