// frontend/src/app/c/[slug]/route.ts

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// Use Node runtime for the service-role client; Fluid Compute keeps this fast.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function truncateIp(raw: string | null): string | null {
  if (!raw) return null
  // x-forwarded-for may contain multiple IPs; take the first
  const ip = raw.split(",")[0].trim()
  if (ip.includes(":")) {
    // IPv6 → /48. Handle "::" compressed form by taking up to 3 hextets
    // before any "::" compression point.
    const compressIdx = ip.indexOf("::")
    const head = compressIdx >= 0 ? ip.slice(0, compressIdx) : ip
    const hextets = head.split(":").filter(Boolean).slice(0, 3)
    return hextets.length > 0 ? hextets.join(":") + "::/48" : "::/48"
  }
  // IPv4 → /24
  const octets = ip.split(".")
  if (octets.length !== 4) return null
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  const { data: link } = await supabase
    .from("collateral_links")
    .select("id, active, item_id, arsenal_items(url, active)")
    .eq("slug", slug)
    .maybeSingle()

  const item = Array.isArray(link?.arsenal_items) ? link.arsenal_items[0] : link?.arsenal_items

  if (!link || !link.active || !item?.active) {
    return new NextResponse(
      "<!doctype html><title>Content unavailable</title><body style=\"font-family:system-ui;margin:3rem auto;max-width:420px;padding:0 1rem\"><h1>This content is no longer available</h1><p>The person who shared this link may have removed or updated it.</p></body>",
      { status: 410, headers: { "content-type": "text/html", "cache-control": "no-store" } },
    )
  }

  // Fire-and-forget insert — await to ensure Fluid Compute doesn't kill it
  await supabase.from("collateral_events").insert({
    link_id: link.id,
    event_type: "opened",
    user_agent: request.headers.get("user-agent"),
    ip_prefix: truncateIp(request.headers.get("x-forwarded-for")),
    referrer: request.headers.get("referer"),
  })

  const redirect = NextResponse.redirect(item.url, 302)
  redirect.headers.set("cache-control", "no-store")
  return redirect
}
