"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { KeychainLogo } from "./keychain-logo"
import { UserMenu } from "./user-menu"
import { LayoutDashboard, GitBranch } from "lucide-react"

const NAV_ITEMS = [
  { href: "/dashboard", label: "Briefing", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", icon: GitBranch },
] as const

export function AppNav() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-white/10 bg-kc-charcoal px-4">
      {/* Left: logo */}
      <Link href="/dashboard" className="flex items-center">
        <KeychainLogo size="sm" className="[&_span]:text-white" />
      </Link>

      {/* Center: nav links */}
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
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Right: user menu */}
      <UserMenu name="Alex Gold" email="alex.gold@keychain.com" />
    </header>
  )
}
