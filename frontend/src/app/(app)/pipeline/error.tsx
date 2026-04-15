"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"

export default function PipelineError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <h2 className="text-xl font-semibold text-kc-charcoal">
        Something went wrong
      </h2>
      <p className="mt-2 text-kc-text-muted">
        {error.message || "Failed to load your pipeline."}
      </p>
      <button
        onClick={unstable_retry}
        className="mt-4 rounded-lg bg-kc-gold px-4 py-2 text-sm font-medium text-kc-charcoal transition-colors hover:bg-kc-gold-dark"
      >
        Try again
      </button>
    </div>
  )
}
