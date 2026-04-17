"use client"

import { useMemo, useState } from "react"
import type { ArsenalItem, ArsenalShelf } from "@/lib/types"
import { AdminItemRow } from "./admin-item-row"
import { AddItemDialog } from "./add-item-dialog"
import { Button } from "@/components/ui/button"

const TABS: { key: ArsenalShelf; label: string }[] = [
  { key: "reference", label: "Reference" },
  { key: "collateral", label: "Collateral" },
  { key: "report", label: "Reports" },
]

export function AdminArsenalClient({ initialItems }: { initialItems: ArsenalItem[] }) {
  const [items, setItems] = useState(initialItems)
  const [tab, setTab] = useState<ArsenalShelf>("reference")
  const [addOpen, setAddOpen] = useState(false)

  const visible = useMemo(
    () => items.filter((i) => i.type === tab).sort((a, b) => a.sort_order - b.sort_order),
    [items, tab],
  )

  return (
    <div className="space-y-4">
      <nav className="flex gap-4 border-b border-kc-warm-gray-dark">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`py-3 text-sm font-medium ${
              tab === t.key ? "border-b-2 border-kc-gold text-kc-charcoal" : "text-kc-text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto self-center">
          <Button size="sm" onClick={() => setAddOpen(true)}>Add item</Button>
        </div>
      </nav>

      {visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-kc-text-muted">
          No items yet. Click &ldquo;Add item&rdquo; to get started.
        </p>
      ) : (
        <ul className="divide-y divide-kc-warm-gray-dark">
          {visible.map((item) => (
            <AdminItemRow
              key={item.id}
              item={item}
              onChange={(updated) =>
                setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
              }
              onSoftDelete={(id) =>
                setItems((prev) => prev.map((i) => (i.id === id ? { ...i, active: false } : i)))
              }
            />
          ))}
        </ul>
      )}

      <AddItemDialog
        scope="global"
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultType={tab}
        onCreated={(item) => setItems((prev) => [item, ...prev])}
      />
    </div>
  )
}
