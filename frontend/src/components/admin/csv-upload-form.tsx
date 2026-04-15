"use client"

import { useState, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Upload, FileText, CheckCircle, AlertCircle, Loader2 } from "lucide-react"
import * as Sentry from "@sentry/nextjs"

interface ImportResult {
  rowsProcessed: number
  opportunitiesUpserted: number
  contactsUpserted: number
  linksCreated: number
  unmatchedOwners: string[]
  errors: string[]
}

export function CsvUploadForm() {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleUpload() {
    if (!file) return

    setUploading(true)
    setError(null)
    setResult(null)

    try {
      await Sentry.startSpan({ name: "csv.upload", op: "http.client" }, async () => {
        const formData = new FormData()
        formData.append("file", file)

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/csv-import`,
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
      {/* Upload card */}
      <Card className="border-kc-warm-gray-dark/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4 text-kc-gold-dark" />
            Upload Salesforce CSV
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-kc-warm-gray-dark p-8 transition-colors hover:border-kc-gold/50 hover:bg-kc-gold-subtle/20"
            onClick={() => inputRef.current?.click()}
          >
            <FileText className="mb-3 h-8 w-8 text-kc-text-muted" />
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
                  Click to select a CSV file
                </p>
                <p className="mt-1 text-xs text-kc-text-muted">
                  Salesforce opportunity export with contacts
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

          <Button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="w-full gap-2 bg-kc-gold text-kc-charcoal hover:bg-kc-gold-dark"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Import CSV
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <Card className="border-kc-danger/30 bg-kc-danger/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-kc-danger" />
            <div>
              <p className="text-sm font-medium text-kc-danger">Import Failed</p>
              <p className="mt-1 text-xs text-kc-text-muted">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {result && (
        <Card className="border-kc-success/30 bg-kc-success/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle className="h-5 w-5 text-kc-success" />
              <p className="text-sm font-medium text-kc-success">Import Complete</p>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <ResultStat label="Rows Processed" value={result.rowsProcessed} />
              <ResultStat label="Opportunities" value={result.opportunitiesUpserted} />
              <ResultStat label="Contacts" value={result.contactsUpserted} />
              <ResultStat label="Links Created" value={result.linksCreated} />
            </div>
            {result.unmatchedOwners.length > 0 && (
              <div className="mt-4 rounded-lg bg-kc-warning/10 p-3">
                <p className="text-xs font-medium text-kc-warning">
                  Unmatched Owners ({result.unmatchedOwners.length})
                </p>
                <p className="mt-1 text-xs text-kc-text-muted">
                  {result.unmatchedOwners.join(", ")}
                </p>
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="mt-4 rounded-lg bg-kc-danger/10 p-3">
                <p className="text-xs font-medium text-kc-danger">
                  Errors ({result.errors.length})
                </p>
                <ul className="mt-1 text-xs text-kc-text-muted list-disc pl-4">
                  {result.errors.slice(0, 5).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function ResultStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xl font-bold text-kc-charcoal">{value.toLocaleString()}</p>
      <p className="text-xs text-kc-text-muted">{label}</p>
    </div>
  )
}
