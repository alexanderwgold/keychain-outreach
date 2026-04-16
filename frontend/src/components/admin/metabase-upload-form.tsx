"use client"

import { useState, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Upload, Database, CheckCircle, AlertCircle, Loader2 } from "lucide-react"
import * as Sentry from "@sentry/nextjs"

interface IngestResult {
  rowsProcessed: number
  chunksUpserted: number
  errors: number
  message?: string
}

export function MetabaseUploadForm() {
  const [file, setFile] = useState<File | null>(null)
  const [reportName, setReportName] = useState("")
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<IngestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleUpload() {
    if (!file) return

    setUploading(true)
    setError(null)
    setResult(null)

    try {
      await Sentry.startSpan({ name: "metabase.ingest", op: "http.client" }, async () => {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("report_name", reportName || file.name)

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ingest-metabase`,
          {
            method: "POST",
            body: formData,
            headers: {
              Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
            },
          }
        )

        if (!response.ok) {
          const text = await response.text()
          throw new Error(`Upload failed: ${response.status} ${text}`)
        }

        const data = await response.json()
        setResult(data)
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed"
      setError(message)
      Sentry.captureException(err)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-kc-warm-gray-dark/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-kc-gold-dark" />
            Upload Metabase Report
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-kc-warm-gray-dark p-8 transition-colors hover:border-kc-gold/50 hover:bg-kc-gold-subtle/20"
            onClick={() => inputRef.current?.click()}
          >
            <Database className="mb-3 h-8 w-8 text-kc-text-muted" />
            {file ? (
              <div className="text-center">
                <p className="text-sm font-medium text-kc-charcoal">{file.name}</p>
                <p className="mt-1 text-xs text-kc-text-muted">
                  {(file.size / 1024).toFixed(0)} KB
                </p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-sm font-medium text-kc-charcoal">
                  Click to select a Metabase CSV export
                </p>
                <p className="mt-1 text-xs text-kc-text-muted">
                  Manufacturer activity data with platform stats
                </p>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const selected = e.target.files?.[0]
                if (selected) setFile(selected)
              }}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-kc-text-muted">
              Report Name (optional)
            </label>
            <Input
              placeholder="e.g. manufacturer_activity_2026-04"
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
            />
          </div>

          <Button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="w-full gap-2 bg-kc-gold text-kc-charcoal hover:bg-kc-gold-dark"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Embedding &amp; uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Ingest Report
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-kc-danger/30 bg-kc-danger/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-kc-danger" />
            <div>
              <p className="text-sm font-medium text-kc-danger">Ingest Failed</p>
              <p className="mt-1 text-xs text-kc-text-muted">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className="border-kc-success/30 bg-kc-success/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle className="h-5 w-5 text-kc-success" />
              <p className="text-sm font-medium text-kc-success">Ingest Complete</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-xl font-bold text-kc-charcoal">{result.rowsProcessed.toLocaleString()}</p>
                <p className="text-xs text-kc-text-muted">Rows Processed</p>
              </div>
              <div>
                <p className="text-xl font-bold text-kc-charcoal">{result.chunksUpserted.toLocaleString()}</p>
                <p className="text-xs text-kc-text-muted">Chunks Embedded</p>
              </div>
              <div>
                <p className="text-xl font-bold text-kc-charcoal">{result.errors}</p>
                <p className="text-xs text-kc-text-muted">Errors</p>
              </div>
            </div>
            {result.message && (
              <p className="mt-3 text-xs text-kc-text-muted">{result.message}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
