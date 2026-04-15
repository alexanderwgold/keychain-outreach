import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get("code")
  const next = searchParams.get("next") ?? "/dashboard"

  if (!code) {
    Sentry.captureMessage("Auth callback called without code parameter", "warning")
    return NextResponse.redirect(`${origin}/?error=no_code`)
  }

  return await Sentry.startSpan(
    { name: "auth.callback", op: "auth" },
    async () => {
      const cookieStore = await cookies()

      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() {
              return cookieStore.getAll()
            },
            setAll(cookiesToSet) {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            },
          },
        }
      )

      const { error } = await supabase.auth.exchangeCodeForSession(code)

      if (error) {
        Sentry.captureException(error)
        return NextResponse.redirect(`${origin}/?error=auth_failed`)
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  )
}
