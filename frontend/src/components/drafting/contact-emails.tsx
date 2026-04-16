"use client"

import { useState, useEffect } from "react"
import { ChevronDown, ChevronRight, ArrowUpRight, ArrowDownLeft, ExternalLink, Loader2, Mail } from "lucide-react"
import * as Sentry from "@sentry/nextjs"
import { createClient } from "@/lib/supabase/client"
import { formatRelativeDateShort } from "@/lib/format"

interface EmailThread {
  subject: string
  snippet: string
  date: string
  direction: "sent" | "received"
  gmailUrl: string
}

interface ContactEmailsProps {
  repEmail: string
  contactEmail: string | null
}

export function ContactEmails({ repEmail, contactEmail }: ContactEmailsProps) {
  const [expanded, setExpanded] = useState(false)
  const [threads, setThreads] = useState<EmailThread[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!contactEmail || !repEmail) return
    setLoading(true)
    setError(null)

    const controller = new AbortController()
    const { signal } = controller

    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (signal.aborted) return
      if (!session) {
        setError("Please sign in again")
        setLoaded(true)
        setLoading(false)
        return
      }
      return fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-contact-emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ repEmail, contactEmail }),
        signal,
      })
        .then((res) => res?.json())
        .then((data) => {
          if (signal.aborted || !data) return
          if (data.error === "no_google_token") {
            setError("Connect Google to see email history")
          } else if (data.error) {
            // Any other backend error (Gmail search failed, token refresh
            // failed, etc.) used to be silently swallowed. Surface a generic
            // message to the rep and log the raw error for debugging.
            Sentry.captureMessage(`contact-emails error: ${data.error}`, "warning")
            setError("Couldn't load emails")
          } else {
            setThreads(data.threads ?? [])
          }
          setLoaded(true)
        })
        .catch((err) => {
          if (signal.aborted || err?.name === "AbortError") return
          setError("Failed to load emails")
          setLoaded(true)
        })
        .finally(() => {
          if (!signal.aborted) setLoading(false)
        })
    })

    return () => {
      controller.abort()
    }
  }, [repEmail, contactEmail])

  if (!contactEmail) return null

  return (
    <div className="rounded-lg border border-kc-warm-gray-dark/30 bg-white">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-kc-text-muted hover:text-kc-charcoal"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Mail className="h-3.5 w-3.5" />
        Recent Emails
        {loaded && !error && (
          <span className="text-kc-text-muted">({threads.length})</span>
        )}
        {loading && <Loader2 className="h-3 w-3 animate-spin" />}
      </button>

      {expanded && (
        <div className="border-t border-kc-warm-gray-dark/20 px-3 pb-2">
          {loading && !loaded && (
            <div className="flex items-center gap-2 py-3 text-xs text-kc-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading emails...
            </div>
          )}

          {error && (
            <p className="py-3 text-xs text-kc-text-muted">{error}</p>
          )}

          {loaded && !error && threads.length === 0 && (
            <p className="py-3 text-xs text-kc-text-muted">No recent emails with this contact</p>
          )}

          {threads.map((thread, i) => (
            <div
              key={i}
              className="flex items-start gap-2 border-b border-kc-warm-gray-dark/10 py-2 last:border-0"
            >
              {thread.direction === "sent" ? (
                <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-kc-gold-dark" />
              ) : (
                <ArrowDownLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-kc-text-muted" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-kc-charcoal">{thread.subject}</p>
                <p className="truncate text-xs text-kc-text-muted">{thread.snippet}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="text-xs text-kc-text-muted">{formatRelativeDateShort(thread.date)}</span>
                <a
                  href={thread.gmailUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-kc-text-muted hover:text-kc-charcoal"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
