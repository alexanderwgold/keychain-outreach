"use client"

import { useEffect, useMemo, useState } from "react"
import type { ArsenalItem, ArsenalItemWithStats, ArsenalShelf } from "@/lib/types"
import { createClient } from "@/lib/supabase/client"
import { ArsenalTile } from "./arsenal-tile"
import { ArsenalDrawer } from "./arsenal-drawer"
import { AddItemDialog } from "./add-item-dialog"
import { Button } from "@/components/ui/button"

type Stats = Record<string, { openCount: number; lastOpenedAt: string | null; linkSlug: string | null }>

const TABS: { key: ArsenalShelf; label: string }[] = [
  { key: "reference", label: "Reference" },
  { key: "collateral", label: "Collateral" },
  { key: "report", label: "Reports" },
]

export function RepArsenalClient({
  globalItems,
  mineItems,
  repEmail,
  itemIds,
}: {
  globalItems: ArsenalItem[]
  mineItems: ArsenalItem[]
  repEmail: string
  itemIds: string[]
}) {
  const [tab, setTab] = useState<ArsenalShelf>("reference")
  const [activeItem, setActiveItem] = useState<ArsenalItem | null>(null)
  const [mine, setMine] = useState(mineItems)
  const [addOpen, setAddOpen] = useState(false)
  const [stats, setStats] = useState<Stats>({})

  useEffect(() => {
    if (itemIds.length === 0) return
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token
      if (!token) return
      fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/arsenal-stats?itemIds=${itemIds.join(",")}`, {
        headers: { authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((data) => setStats(data))
        .catch(() => { /* stats failure is non-critical */ })
    })
  }, [itemIds])

  const decorate = (items: ArsenalItem[]): ArsenalItemWithStats[] =>
    items.map((i) => ({
      ...i,
      openCount: stats[i.id]?.openCount ?? 0,
      lastOpenedAt: stats[i.id]?.lastOpenedAt ?? null,
      linkSlug: stats[i.id]?.linkSlug ?? null,
    }))

  const visibleGlobal = useMemo(
    () => decorate(globalItems.filter((i) => i.type === tab)),
    [globalItems, stats, tab],
  )

  return (
    <div className="space-y-10 p-6">
      <section>
        <h1 className="mb-1 text-2xl font-semibold text-kc-charcoal">Shared Library</h1>
        <p className="mb-4 text-sm text-kc-text-muted">Reference material, prospect collateral, and team reports.</p>

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
        </nav>

        {visibleGlobal.length === 0 ? (
          <p className="py-12 text-center text-sm text-kc-text-muted">Nothing here yet.</p>
        ) : (
          <ul className="mt-4 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
            {visibleGlobal.map((i) => (
              <ArsenalTile key={i.id} item={i} onOpen={() => setActiveItem(i)} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-kc-charcoal">My Content</h2>
            <p className="text-sm text-kc-text-muted">Private — only you see these.</p>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>Add item</Button>
        </div>
        {mine.length === 0 ? (
          <p className="py-12 text-center text-sm text-kc-text-muted">
            Save Drive links or PDFs you want quick access to.
          </p>
        ) : (
          <ul className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
            {decorate(mine).map((i) => (
              <ArsenalTile key={i.id} item={i} onOpen={() => setActiveItem(i)} />
            ))}
          </ul>
        )}
      </section>

      <ArsenalDrawer
        item={activeItem}
        onClose={() => setActiveItem(null)}
        stats={activeItem ? stats[activeItem.id] ?? null : null}
      />

      <AddItemDialog
        scope="private"
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultType="collateral"
        onCreated={(item) => setMine((prev) => [item, ...prev])}
      />
    </div>
  )
}
