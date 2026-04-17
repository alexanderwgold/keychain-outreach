"use client"

import { useState } from "react"
import type { ArsenalItem } from "@/lib/types"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Copy, Mail } from "lucide-react"

const ORIGIN = typeof window === "undefined" ? "" : window.location.origin

export function ArsenalDrawer({
  item,
  onClose,
  stats,
}: {
  item: ArsenalItem | null
  onClose: () => void
  stats: { openCount: number; lastOpenedAt: string | null; linkSlug: string | null } | null
}) {
  const [busy, setBusy] = useState(false)

  if (!item) return null

  async function createAndCopy() {
    setBusy(true)
    try {
      const supabase = createClient()
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/arsenal-create-link`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ itemId: item!.id, prospectEmail: null }),
      })
      if (!res.ok) throw new Error(await res.text())
      const { slug } = await res.json()
      await navigator.clipboard.writeText(`${ORIGIN}/c/${slug}`)
      alert("Short link copied")
    } catch (e) { alert(String(e)) } finally { setBusy(false) }
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

      <div className="flex gap-2">
        <Button onClick={createAndCopy} disabled={busy} className="gap-2">
          <Copy className="h-4 w-4" /> Copy trackable link
        </Button>
        <Button variant="secondary" className="gap-2" disabled={busy}>
          <Mail className="h-4 w-4" /> Send via Gmail
        </Button>
      </div>

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
