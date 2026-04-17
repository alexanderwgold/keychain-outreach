import { Suspense } from "react"
import { getGlobalArsenalItems } from "@/lib/data/arsenal"
import { AdminArsenalClient } from "@/components/arsenal/admin-arsenal-client"

export default async function AdminArsenalPage() {
  const items = await getGlobalArsenalItems()
  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-kc-charcoal">Arsenal · Shared Library</h1>
        <p className="text-sm text-kc-text-muted">
          Manage the content every rep sees. Soft-deletes preserve historical links.
        </p>
      </header>
      <Suspense>
        <AdminArsenalClient initialItems={items} />
      </Suspense>
    </div>
  )
}
