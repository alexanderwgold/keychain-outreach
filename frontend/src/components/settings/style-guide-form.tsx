"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Sparkles, Save, RefreshCw, Loader2, CheckCircle, AlertCircle } from "lucide-react"
import * as Sentry from "@sentry/nextjs"
import { createClient } from "@/lib/supabase/client"

interface StyleGuideData {
  toneAndVoice: string
  openingStyle: string
  closingAndSignoff: string
  thingsToAvoid: string
  examplePhrases: string
  generatedFrom?: {
    email_count?: number
    date_range?: string
    analyzed_at?: string
  }
}

interface StyleGuideFormProps {
  repEmail: string
  initialData: StyleGuideData | null
}

const SECTIONS = [
  { key: "toneAndVoice", label: "Tone & Voice", placeholder: "How you sound in emails — formal, casual, warm, direct..." },
  { key: "openingStyle", label: "Opening Style", placeholder: "How you typically start emails — pleasantries, jump straight in, reference something specific..." },
  { key: "closingAndSignoff", label: "Closing & Sign-off", placeholder: "How you end emails — sign-off phrase, CTA style, closing remarks..." },
  { key: "thingsToAvoid", label: "Things to Avoid", placeholder: "Phrases or patterns that would feel out of character for you..." },
  { key: "examplePhrases", label: "Example Phrases", placeholder: "Specific phrases, expressions, or patterns you use often..." },
] as const

export function StyleGuideForm({ repEmail, initialData }: StyleGuideFormProps) {
  const [data, setData] = useState<StyleGuideData>(initialData ?? {
    toneAndVoice: "",
    openingStyle: "",
    closingAndSignoff: "",
    thingsToAvoid: "",
    examplePhrases: "",
  })
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasGuide = !!(data.toneAndVoice || data.openingStyle || data.closingAndSignoff)

  async function handleAnalyze() {
    setAnalyzing(true)
    setError(null)

    try {
      await Sentry.startSpan({ name: "style.analyze", op: "ai.run" }, async () => {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          setError("Please sign in again")
          return
        }
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/analyze-style`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ repEmail }),
          }
        )

        const result = await response.json()

        if (!response.ok) {
          if (result.error === "insufficient_emails") {
            throw new Error(`Not enough emails found (${result.emailsFound}). You need at least 5 substantive sent emails in the last 30 days. You can fill in the sections manually instead.`)
          }
          throw new Error(result.error ?? "Analysis failed")
        }

        setData({
          toneAndVoice: result.toneAndVoice,
          openingStyle: result.openingStyle,
          closingAndSignoff: result.closingAndSignoff,
          thingsToAvoid: result.thingsToAvoid,
          examplePhrases: result.examplePhrases,
          generatedFrom: {
            email_count: result.emailsAnalyzed,
            date_range: result.dateRange,
            analyzed_at: new Date().toISOString(),
          },
        })
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Analysis failed"
      setError(message)
      Sentry.captureException(err)
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaveSuccess(false)

    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError("Please sign in again")
        setSaving(false)
        return
      }
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/save-style-guide`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            repEmail,
            toneAndVoice: data.toneAndVoice,
            openingStyle: data.openingStyle,
            closingAndSignoff: data.closingAndSignoff,
            thingsToAvoid: data.thingsToAvoid,
            examplePhrases: data.examplePhrases,
          }),
        }
      )

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error ?? "Save failed")
      }

      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed"
      setError(message)
      Sentry.captureException(err)
    } finally {
      setSaving(false)
    }
  }

  function updateField(key: string, value: string) {
    setData((prev) => ({ ...prev, [key]: value }))
    setSaveSuccess(false)
  }

  return (
    <div className="space-y-6">
      {/* Onboarding: no guide yet */}
      {!hasGuide && !analyzing && (
        <Card className="border-kc-gold/30 bg-kc-gold-subtle/20">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <Sparkles className="h-8 w-8 text-kc-gold-dark" />
            <div>
              <p className="text-sm font-medium text-kc-charcoal">
                Build Your Writing Style Guide
              </p>
              <p className="mt-1 text-xs text-kc-text-muted max-w-sm">
                Claude will scan your last 30 days of sent emails to learn your writing style. This takes about 30 seconds. You can edit the result anytime.
              </p>
            </div>
            <Button
              onClick={handleAnalyze}
              className="gap-2 bg-kc-gold text-kc-charcoal hover:bg-kc-gold-dark"
            >
              <Sparkles className="h-4 w-4" />
              Build My Style Guide
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Analyzing state */}
      {analyzing && (
        <Card className="border-kc-gold/30">
          <CardContent className="flex flex-col items-center gap-3 p-8">
            <Loader2 className="h-6 w-6 animate-spin text-kc-gold" />
            <p className="text-sm text-kc-text-muted">Analyzing your emails...</p>
            <p className="text-xs text-kc-text-muted">This usually takes 15-30 seconds</p>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="border-kc-danger/30 bg-kc-danger/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-kc-danger" />
            <div>
              <p className="text-sm font-medium text-kc-danger">Error</p>
              <p className="mt-1 text-xs text-kc-text-muted">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Style guide form */}
      {hasGuide && !analyzing && (
        <>
          {data.generatedFrom?.email_count && (
            <p className="text-xs text-kc-text-muted">
              Generated from {data.generatedFrom.email_count} emails ({data.generatedFrom.date_range})
            </p>
          )}

          {SECTIONS.map(({ key, label, placeholder }) => (
            <Card key={key} className="border-kc-warm-gray-dark/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-kc-charcoal">{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={data[key as keyof StyleGuideData] as string}
                  onChange={(e) => updateField(key, e.target.value)}
                  placeholder={placeholder}
                  rows={3}
                  className="resize-none text-sm"
                />
              </CardContent>
            </Card>
          ))}

          <div className="flex gap-3">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 gap-2 bg-kc-gold text-kc-charcoal hover:bg-kc-gold-dark"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : saveSuccess ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saveSuccess ? "Saved" : "Save Changes"}
            </Button>
            <Button
              onClick={() => {
                if (confirm("This will overwrite your current guide with a fresh analysis. Continue?")) {
                  handleAnalyze()
                }
              }}
              variant="outline"
              disabled={analyzing}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Rebuild from Emails
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
