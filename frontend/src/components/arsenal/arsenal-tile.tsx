"use client"

import type { ArsenalItemWithStats } from "@/lib/types"
import { formatDistanceToNowStrict } from "date-fns"

export function ArsenalTile({
  item,
  onOpen,
}: {
  item: ArsenalItemWithStats
  onOpen: () => void
}) {
  return (
    <li className="group flex flex-col gap-2 rounded-xl border border-kc-warm-gray-dark bg-white p-4 text-left transition hover:border-kc-gold hover:shadow-sm">
      <button onClick={onOpen} className="flex flex-1 flex-col gap-2 text-left">
        <span className="text-xs font-medium uppercase tracking-wide text-kc-text-muted">
          {item.type}
        </span>
        <span className="text-base font-semibold text-kc-charcoal">{item.title}</span>
        {item.description && (
          <span className="text-sm text-kc-text-muted line-clamp-2">{item.description}</span>
        )}
      </button>
      {item.tags.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {item.tags.map((t) => (
            <li key={t} className="rounded-full bg-kc-warm-gray px-2 py-0.5 text-xs text-kc-text">{t}</li>
          ))}
        </ul>
      )}
      {item.openCount > 0 && (
        <p className="mt-1 text-xs text-kc-text-muted">
          {item.openCount} open{item.openCount === 1 ? "" : "s"}
          {item.lastOpenedAt && ` · last ${formatDistanceToNowStrict(new Date(item.lastOpenedAt))} ago`}
        </p>
      )}
    </li>
  )
}
