"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Search } from "lucide-react"
import { PIPELINE_STAGES } from "@/lib/constants"

export function PipelineFilters() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const currentStage = searchParams.get("stage") ?? ""
  const currentSearch = searchParams.get("q") ?? ""

  const updateParams = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      params.delete("page")
      router.push(`/pipeline?${params.toString()}`)
    },
    [router, searchParams]
  )

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-kc-text-muted" />
        <Input
          placeholder="Search by company or opportunity..."
          defaultValue={currentSearch}
          onChange={(e) => {
            const value = e.target.value
            const timeout = setTimeout(() => updateParams("q", value), 300)
            return () => clearTimeout(timeout)
          }}
          className="pl-9"
        />
      </div>
      <Select
        value={currentStage || "all"}
        onValueChange={(value) => updateParams("stage", value === "all" ? "" : value)}
      >
        <SelectTrigger className="w-full sm:w-[220px]">
          <SelectValue placeholder="All stages" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All stages</SelectItem>
          {PIPELINE_STAGES.map((stage) => (
            <SelectItem key={stage} value={stage}>
              {stage}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
