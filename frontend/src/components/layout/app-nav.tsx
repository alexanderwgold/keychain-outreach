"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { KeychainLogo } from "./keychain-logo"
import { UserMenu } from "./user-menu"
import { useUser } from "@/hooks/use-user"
import { LayoutDashboard, GitBranch, Library, Settings } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"

const NAV_ITEMS = [
  { href: "/dashboard", label: "Briefing", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", icon: GitBranch },
  { href: "/arsenal", label: "Arsenal", icon: Library },
  { href: "/settings", label: "Settings", icon: Settings },
] as const

export function AppNav() {
  const pathname = usePathname()
  const { user, loading } = useUser()

  const displayName = user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "User"
  const displayEmail = user?.email ?? ""

  return (
    <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-white/10 bg-kc-charcoal px-6">
      <Link href="/dashboard" className="flex items-center">
        <KeychainLogo size="sm" showSparkle={false} className="[&_span]:text-white" />
      </Link>

      <nav className="flex items-center gap-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-kc-gold/15 text-kc-gold"
                  : "text-white/60 hover:bg-white/5 hover:text-white/90"
              )}
            >
              <Icon className="h-4 w-4" aria-hidden={true} />
              {label}
            </Link>
          )
        })}
      </nav>

      {loading ? (
        <Skeleton className="h-7 w-24 bg-white/10" />
      ) : (
        <UserMenu name={displayName} email={displayEmail} />
      )}
    </header>
  )
}
