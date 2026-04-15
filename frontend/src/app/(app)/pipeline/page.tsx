import { Suspense } from "react"
import { createClient } from "@/lib/supabase/server"
import { getPipelineData } from "@/lib/data/pipeline"
import { PipelineTable } from "@/components/pipeline/pipeline-table"
import { PipelineFilters } from "@/components/pipeline/pipeline-filters"
import PipelineLoading from "./loading"

interface PipelinePageProps {
  searchParams: Promise<{
    page?: string
    stage?: string
    q?: string
  }>
}

export default async function PipelinePage({ searchParams }: PipelinePageProps) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const repEmail = user?.email ?? ""
  const page = parseInt(params.page ?? "1", 10)
  const stageFilter = params.stage ?? ""
  const search = params.q ?? ""

  const data = await getPipelineData(repEmail, {
    page,
    pageSize: 25,
    stageFilter: stageFilter || undefined,
    search: search || undefined,
  })

  const filterParams = new URLSearchParams()
  if (stageFilter) filterParams.set("stage", stageFilter)
  if (search) filterParams.set("q", search)
  const basePath = `/pipeline?${filterParams.toString()}${filterParams.toString() ? "&" : ""}`

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-kc-charcoal">Pipeline</h1>
        <p className="mt-1 text-kc-text-muted">
          {data.totalCount} opportunities
        </p>
      </div>

      <PipelineFilters />

      <Suspense fallback={<PipelineLoading />}>
        <PipelineTable data={data} basePath={basePath} />
      </Suspense>
    </div>
  )
}
