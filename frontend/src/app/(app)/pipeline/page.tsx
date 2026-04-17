import { Suspense } from "react"
import { createClient } from "@/lib/supabase/server"
import { getPipelineData, getPipelineStageAggregates } from "@/lib/data/pipeline"
import { PipelineTable } from "@/components/pipeline/pipeline-table"
import { PipelineFilters } from "@/components/pipeline/pipeline-filters"
import { PipelineChart } from "@/components/pipeline/pipeline-chart"
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

  const [data, aggregates] = await Promise.all([
    getPipelineData(repEmail, {
      page,
      pageSize: 25,
      stageFilter: stageFilter || undefined,
      search: search || undefined,
    }),
    getPipelineStageAggregates(repEmail),
  ])

  const filterParams = new URLSearchParams()
  if (stageFilter) filterParams.set("stage", stageFilter)
  if (search) filterParams.set("q", search)
  const basePath = `/pipeline?${filterParams.toString()}${filterParams.toString() ? "&" : ""}`

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-kc-charcoal">Pipeline</h1>
        <p className="mt-1 text-kc-text-muted">
          {stageFilter ? `${data.totalCount} in ${stageFilter}` : `${data.totalCount} opportunities`}
        </p>
      </div>

      <PipelineChart aggregates={aggregates} activeStage={stageFilter || null} />

      <PipelineFilters />

      <Suspense fallback={<PipelineLoading />}>
        <PipelineTable data={data} basePath={basePath} repEmail={repEmail} />
      </Suspense>
    </div>
  )
}
