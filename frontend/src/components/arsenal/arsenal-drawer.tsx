"use client"

import { useEffect, useState } from "react"
import type { ArsenalItem } from "@/lib/types"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Copy, Mail } from "lucide-react"

const ORIGIN = typeof window === "undefined" ? "" : window.location.origin

const DRIVE_FILE_ID_RE = /\/(?:d|file\/d)\/([a-zA-Z0-9_-]+)/

function isDriveUrl(url: string): boolean {
  return url.includes("drive.google.com") || url.includes("docs.google.com")
}

function extractDriveFileId(url: string): string | null {
  return url.match(DRIVE_FILE_ID_RE)?.[1] ?? null
}

export type ArsenalSendPayload = {
  initialTo: string
  prefillBody: string
  initialSubject: string
  extraAttachments?: Array<
    | { storageKey: string; filename: string }
    | { driveFileId: string; filename?: string }
  >
}

export function ArsenalDrawer({
  item,
  onClose,
  stats,
  onSend,
}: {
  item: ArsenalItem | null
  onClose: () => void
  stats: { openCount: number; lastOpenedAt: string | null; linkSlug: string | null } | null
  onSend: (payload: ArsenalSendPayload) => void
}) {
  const [busy, setBusy] = useState(false)
  const [inSendMode, setInSendMode] = useState(false)
  const [prospectEmail, setProspectEmail] = useState("")
  const [attachDrive, setAttachDrive] = useState(false)
  const [creatingLink, setCreatingLink] = useState(false)
  const [sendErr, setSendErr] = useState<string | null>(null)

  useEffect(() => {
    // When the active arsenal item changes (or drawer closes), reset send state
    setInSendMode(false)
    setProspectEmail("")
    setAttachDrive(false)
    setSendErr(null)
  }, [item?.id])

  if (!item) return null

  async function createAndCopy() {
    if (!item) return
    setBusy(true)
    try {
      const supabase = createClient()
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/arsenal-create-link`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ itemId: item.id, prospectEmail: null }),
      })
      if (!res.ok) throw new Error(await res.text())
      const { slug } = await res.json()
      await navigator.clipboard.writeText(`${ORIGIN}/c/${slug}`)
      alert("Short link copied")
    } catch (e) { alert(String(e)) } finally { setBusy(false) }
  }

  async function openDraftForSend() {
    if (!item || !prospectEmail) return
    setCreatingLink(true)
    setSendErr(null)
    try {
      const supabase = createClient()
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/arsenal-create-link`,
        {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ itemId: item.id, prospectEmail }),
        },
      )
      if (!res.ok) throw new Error(await res.text())
      const { slug } = await res.json()
      const shortUrl = `${ORIGIN}/c/${slug}`

      const extras: Array<
        | { storageKey: string; filename: string }
        | { driveFileId: string; filename?: string }
      > = []
      if (item.storage_path) {
        extras.push({ storageKey: item.storage_path, filename: item.title })
      } else if (attachDrive && isDriveUrl(item.url)) {
        const fileId = extractDriveFileId(item.url)
        if (fileId) extras.push({ driveFileId: fileId })
      }

      onSend({
        initialTo: prospectEmail,
        initialSubject: item.title,
        prefillBody: `<p>Hi,</p><p>Sharing this — might be useful:</p><p><a href="${shortUrl}">${shortUrl}</a></p><p>Let me know what you think.</p>`,
        extraAttachments: extras.length > 0 ? extras : undefined,
      })
      setInSendMode(false)
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : String(e))
    } finally {
      setCreatingLink(false)
    }
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-40 w-[420px] border-l border-kc-warm-gray-dark bg-white p-6 shadow-xl">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-kc-text-muted">{item.type}</p>
          <h3 className="text-lg font-semibold text-kc-charcoal">{item.title}</h3>
        </div>
        <button aria-label="Close" onClick={onClose} className="text-kc-text-muted">×</button>
      </header>

      {item.description && <p className="mb-4 text-sm text-kc-text">{item.description}</p>}

      <a href={item.url} target="_blank" rel="noreferrer" className="mb-6 block truncate text-sm text-kc-gold underline">
        {item.url}
      </a>

      {item.type === "report" ? (
        <p className="rounded-lg border border-kc-warm-gray-dark bg-kc-warm-gray/40 p-3 text-xs text-kc-text-muted">
          Internal report — available for your reference. Not for sharing outside Keychain.
        </p>
      ) : (
        <>
          <div className="flex gap-2">
            <Button onClick={createAndCopy} disabled={busy} className="gap-2">
              <Copy className="h-4 w-4" /> Copy trackable link
            </Button>
            <Button
              variant="secondary"
              className="gap-2"
              disabled={busy || creatingLink}
              onClick={() => {
                setInSendMode(true)
                setSendErr(null)
              }}
            >
              <Mail className="h-4 w-4" /> Send via Gmail
            </Button>
          </div>

          {inSendMode && (
            <section className="mt-4 space-y-3 rounded-lg border border-kc-warm-gray-dark bg-kc-warm-gray/40 p-4">
              <label className="block space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-kc-text-muted">
                  Prospect email
                </span>
                <input
                  type="email"
                  value={prospectEmail}
                  onChange={(e) => setProspectEmail(e.target.value)}
                  placeholder="prospect@company.com"
                  className="w-full rounded border border-kc-warm-gray-dark bg-white px-3 py-2 text-sm"
                />
              </label>

              {!item.storage_path && isDriveUrl(item.url) && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={attachDrive}
                    onChange={(e) => setAttachDrive(e.target.checked)}
                  />
                  <span className="text-kc-text">Attach the Drive file to the draft</span>
                </label>
              )}

              {sendErr && <p className="text-sm text-red-600">{sendErr}</p>}

              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setInSendMode(false)
                    setSendErr(null)
                  }}
                  disabled={creatingLink}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={openDraftForSend}
                  disabled={creatingLink || !prospectEmail}
                >
                  {creatingLink ? "Opening..." : "Open draft"}
                </Button>
              </div>
            </section>
          )}
        </>
      )}

      {stats && stats.openCount > 0 && (
        <section className="mt-6 rounded-lg bg-kc-warm-gray p-4 text-sm">
          <p className="font-medium text-kc-charcoal">{stats.openCount} opens</p>
          {stats.lastOpenedAt && (
            <p className="text-kc-text-muted">Last open: {new Date(stats.lastOpenedAt).toLocaleString()}</p>
          )}
        </section>
      )}
    </aside>
  )
}
