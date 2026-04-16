"use client"

import { useRouter } from "next/navigation"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LogOut, Settings } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import * as Sentry from "@sentry/nextjs"

interface UserMenuProps {
  name: string
  email: string
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

export function UserMenu({ name, email }: UserMenuProps) {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    Sentry.setUser(null)
    const { error } = await supabase.auth.signOut()
    if (error) {
      Sentry.captureException(error)
    }
    // Always navigate — signing out locally is idempotent and the redirect
    // is the user-visible success signal.
    router.push("/")
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/10" aria-label="User menu">
        <Avatar className="h-7 w-7 border border-white/20">
          <AvatarFallback className="bg-kc-gold text-xs font-semibold text-kc-charcoal">
            {getInitials(name)}
          </AvatarFallback>
        </Avatar>
        <span className="hidden text-sm font-medium text-white/90 md:block">
          {name}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">{email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onClick={handleSignOut}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
