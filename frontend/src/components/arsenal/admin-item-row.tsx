"use client"

import { useState } from "react"
import type { ArsenalItem } from "@/lib/types"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"

export function AdminItemRow({
  item,
  onChange,
  onSoftDelete,
}: {
  item: ArsenalItem
  onChange: (updated: ArsenalItem) => void
  onSoftDelete: (id: string) => void
}) {
  const [busy, setBusy] = useState(false)

  async function softDelete() {
    if (!confirm(`Remove "${item.title}" from the Library? Existing sent links will return "no longer available".`)) return
    setBusy(true)
    const supabase = createClient()
    const { error } = await supabase
      .from("arsenal_items")
      .update({ active: false })
      .eq("id", item.id)
    setBusy(false)
    if (error) { alert(error.message); return }
    onSoftDelete(item.id)
  }

  return (
    <li className="flex items-start gap-4 py-3">
      <div className="flex-1">
        <p className="font-medium text-kc-charcoal">{item.title}</p>
        {item.description && <p className="mt-1 text-sm text-kc-text-muted">{item.description}</p>}
        <p className="mt-1 font-mono text-xs text-kc-text-muted">{item.url}</p>
        {item.tags.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1">
            {item.tags.map((t) => (
              <li key={t} className="rounded-full bg-kc-warm-gray px-2 py-0.5 text-xs text-kc-charcoal">{t}</li>
            ))}
          </ul>
        )}
      </div>
      <Button variant="ghost" size="icon" onClick={softDelete} disabled={busy} aria-label="Remove">
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  )
}
