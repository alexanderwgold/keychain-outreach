"use client"

import { useState } from "react"
import type { ArsenalItem, ArsenalShelf } from "@/lib/types"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

export function AddItemDialog({
  scope,
  open,
  onOpenChange,
  defaultType,
  onCreated,
}: {
  scope: "global" | "private"
  open: boolean
  onOpenChange: (v: boolean) => void
  defaultType: ArsenalShelf
  onCreated: (item: ArsenalItem) => void
}) {
  const [source, setSource] = useState<"url" | "upload">("url")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [url, setUrl] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [type, setType] = useState<ArsenalShelf>(defaultType)
  const [tagsText, setTagsText] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!open) return null

  async function uploadToStorage(f: File): Promise<{ url: string; storagePath: string }> {
    const supabase = createClient()
    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/arsenal-upload-url`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ filename: f.name, scope }),
    })
    if (!res.ok) throw new Error(await res.text())
    const { uploadUrl, path } = await res.json()
    const putRes = await fetch(uploadUrl, { method: "PUT", body: f, headers: { "content-type": f.type } })
    if (!putRes.ok) throw new Error(`upload failed: ${putRes.status}`)
    const { data: { publicUrl } } = supabase.storage.from("arsenal").getPublicUrl(path)
    return { url: publicUrl, storagePath: path }
  }

  async function submit() {
    setErr(null); setBusy(true)
    try {
      const supabase = createClient()
      let finalUrl = url
      let storagePath: string | null = null
      if (source === "upload") {
        if (!file) throw new Error("Pick a file")
        const up = await uploadToStorage(file)
        finalUrl = up.url
        storagePath = up.storagePath
      }
      const tags = tagsText.split(",").map((s) => s.trim()).filter(Boolean)
      const { data: user } = await supabase.auth.getUser()
      const email = user.user?.email
      if (!email) throw new Error("Not signed in")
      const { data, error } = await supabase.from("arsenal_items").insert({
        visibility: scope,
        owner_email: scope === "private" ? email : null,
        type,
        title,
        description,
        url: finalUrl,
        storage_path: storagePath,
        tags,
        created_by: email,
      }).select("*").single()
      if (error) throw error
      onCreated(data)
      onOpenChange(false)
      setTitle(""); setDescription(""); setUrl(""); setFile(null); setTagsText("")
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-kc-charcoal">Add item</h2>

        <div className="flex gap-2 text-sm">
          <button onClick={() => setSource("url")} className={source === "url" ? "font-semibold" : "text-kc-text-muted"}>Paste URL</button>
          <span className="text-kc-text-muted">·</span>
          <button onClick={() => setSource("upload")} className={source === "upload" ? "font-semibold" : "text-kc-text-muted"}>Upload PDF/CSV</button>
        </div>

        <label className="block space-y-1">
          <span className="text-sm text-kc-text">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded border border-kc-warm-gray-dark px-3 py-2 text-sm" />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-kc-text">Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded border border-kc-warm-gray-dark px-3 py-2 text-sm" />
        </label>

        {source === "url" ? (
          <label className="block space-y-1">
            <span className="text-sm text-kc-text">URL</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/..." className="w-full rounded border border-kc-warm-gray-dark px-3 py-2 text-sm" />
          </label>
        ) : (
          <div className="space-y-1">
            <span className="block text-sm text-kc-text">File</span>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded border border-kc-warm-gray-dark bg-white px-3 py-2 text-sm transition hover:border-kc-gold">
              <span className={`truncate ${file ? "text-kc-charcoal" : "text-kc-text-muted"}`}>
                {file ? file.name : "Choose a PDF, CSV, or image…"}
              </span>
              <span className="shrink-0 rounded bg-kc-warm-gray px-3 py-1 text-xs font-medium text-kc-charcoal">
                Browse
              </span>
              <input
                type="file"
                accept="application/pdf,text/csv,image/png,image/jpeg"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="sr-only"
              />
            </label>
            <p className="text-xs text-kc-text-muted">PDF, CSV, PNG, or JPEG · up to 50 MB</p>
          </div>
        )}

        <label className="block space-y-1">
          <span className="text-sm text-kc-text">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as ArsenalShelf)} className="w-full rounded border border-kc-warm-gray-dark px-3 py-2 text-sm">
            <option value="reference">Reference</option>
            <option value="collateral">Collateral</option>
            <option value="report">Report</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-kc-text">Tags (comma-separated)</span>
          <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} className="w-full rounded border border-kc-warm-gray-dark px-3 py-2 text-sm" />
        </label>

        {err && <p className="text-sm text-red-600">{err}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !title || (source === "url" ? !url : !file)}>
            {busy ? "Adding..." : "Add"}
          </Button>
        </div>
      </div>
    </div>
  )
}
