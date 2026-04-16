"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Paperclip, X, FileText, Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

export interface AttachmentFile {
  storageKey: string
  filename: string
  size: number
}

interface AttachmentPickerProps {
  attachments: AttachmentFile[]
  onAttachmentsChange: (attachments: AttachmentFile[]) => void
}

export function AttachmentPicker({ attachments, onAttachmentsChange }: AttachmentPickerProps) {
  const [showPicker, setShowPicker] = useState(false)
  const [files, setFiles] = useState<AttachmentFile[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!showPicker) return
    setLoading(true)
    const supabase = createClient()
    supabase.storage
      .from("collateral")
      .list("", { limit: 50, sortBy: { column: "name", order: "asc" } })
      .then(({ data, error }) => {
        if (!error && data) {
          setFiles(
            data
              .filter((f) => f.name !== ".emptyFolderPlaceholder")
              .map((f) => ({
                storageKey: f.name,
                filename: f.name,
                size: f.metadata?.size ?? 0,
              }))
          )
        }
        setLoading(false)
      })
  }, [showPicker])

  function addAttachment(file: AttachmentFile) {
    if (attachments.some((a) => a.storageKey === file.storageKey)) return
    onAttachmentsChange([...attachments, file])
    setShowPicker(false)
  }

  function removeAttachment(storageKey: string) {
    onAttachmentsChange(attachments.filter((a) => a.storageKey !== storageKey))
  }

  return (
    <div className="space-y-2">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((att) => (
            <div
              key={att.storageKey}
              className="flex items-center gap-1.5 rounded-md bg-kc-warm-gray px-2 py-1"
            >
              <FileText className="h-3.5 w-3.5 text-kc-text-muted" />
              <span className="text-xs text-kc-charcoal">{att.filename}</span>
              <button onClick={() => removeAttachment(att.storageKey)} className="ml-1">
                <X className="h-3 w-3 text-kc-text-muted hover:text-kc-danger" />
              </button>
            </div>
          ))}
        </div>
      )}

      {showPicker && (
        <div className="rounded-lg border border-kc-warm-gray-dark/50 bg-white p-3">
          <p className="mb-2 text-xs font-medium text-kc-text-muted">Collateral Files</p>
          {loading ? (
            <div className="flex items-center gap-2 py-4 text-xs text-kc-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading files...
            </div>
          ) : files.length === 0 ? (
            <p className="py-4 text-xs text-kc-text-muted">No files in collateral bucket</p>
          ) : (
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {files.map((file) => (
                <button
                  key={file.storageKey}
                  onClick={() => addAttachment(file)}
                  disabled={attachments.some((a) => a.storageKey === file.storageKey)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-kc-gold-subtle/30 disabled:opacity-50"
                >
                  <FileText className="h-3.5 w-3.5 text-kc-text-muted" />
                  <span className="text-kc-charcoal">{file.filename}</span>
                  <span className="ml-auto text-kc-text-muted">
                    {(file.size / 1024).toFixed(0)} KB
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowPicker(!showPicker)}
        className="gap-1.5 text-xs text-kc-text-muted"
      >
        <Paperclip className="h-3.5 w-3.5" />
        {showPicker ? "Close" : "Attach from Collateral"}
      </Button>
    </div>
  )
}
