# Stage 2: Login & Auth Flow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a branded Google OAuth login page, auth callback handler, user session management, and sign-out — so reps can log in with @keychain.com accounts and the proxy.ts auth guard works end-to-end.

**Architecture:** Supabase Auth with Google as the OAuth provider. The login page calls `supabase.auth.signInWithOAuth` with additional Gmail/Calendar scopes + `access_type=offline`. Supabase redirects to Google, Google redirects back to Supabase Auth, which redirects to our `/api/auth/callback` route handler. The route handler exchanges the code for a Supabase session (setting cookies), then redirects to `/dashboard`. The proxy.ts already checks `supabase.auth.getUser()` on every request.

**Tech Stack:** Supabase Auth (Google provider), @supabase/ssr, Next.js 16 route handlers, Sentry (@sentry/nextjs for user identification + span tracing)

**Prerequisites:** Supabase project must have Google Auth provider enabled with the correct Client ID and Client Secret from the Google Cloud project. Authorized redirect URI in Google Cloud must include `https://hjxaqhbkdvckapsqvqcq.supabase.co/auth/v1/callback`.

---

## Task 1: Styled Google Login Page

**Files:**
- Create: `frontend/src/components/auth/google-login-button.tsx`
- Modify: `frontend/src/app/page.tsx`

- [ ] **Step 1: Create Google login button component**

Create `frontend/src/components/auth/google-login-button.tsx`:

```tsx
"use client"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import * as Sentry from "@sentry/nextjs"

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ")

export function GoogleLoginButton() {
  async function handleLogin() {
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`,
        scopes: GOOGLE_SCOPES,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    })

    if (error) {
      Sentry.captureException(error)
    }
  }

  return (
    <Button
      onClick={handleLogin}
      size="lg"
      className="h-12 gap-3 bg-kc-charcoal px-6 text-base font-semibold text-white hover:bg-kc-charcoal/90"
    >
      <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
      Sign in with Google
    </Button>
  )
}
```

- [ ] **Step 2: Build the login page**

Overwrite `frontend/src/app/page.tsx`:

```tsx
import { KeychainLogo } from "@/components/layout/keychain-logo"
import { SparkleIcon } from "@/components/layout/sparkle-icon"
import { GoogleLoginButton } from "@/components/auth/google-login-button"

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-kc-warm-white px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        {/* Logo */}
        <div className="space-y-3">
          <KeychainLogo size="lg" className="justify-center" />
          <p className="text-lg text-kc-text-muted">Outreach Tool</p>
        </div>

        {/* Login card */}
        <div className="rounded-xl border border-kc-warm-gray-dark bg-white p-8 shadow-sm">
          <h2 className="text-xl font-semibold text-kc-charcoal">
            Welcome back
          </h2>
          <p className="mt-2 text-sm text-kc-text-muted">
            Sign in with your @keychain.com account
          </p>
          <div className="mt-6">
            <GoogleLoginButton />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center gap-1.5 text-xs text-kc-text-muted">
          <SparkleIcon size={10} className="text-kc-gold/50" />
          <span>Powered by Keychain</span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach/frontend && npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add frontend/src/components/auth/google-login-button.tsx frontend/src/app/page.tsx && git commit -m "feat: add styled Google OAuth login page with Keychain branding

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Auth Callback Route Handler

**Files:**
- Create: `frontend/src/app/api/auth/callback/route.ts`

The standard Supabase Auth + Next.js callback: exchanges the `code` query parameter for a session, sets cookies, redirects to `/dashboard`.

- [ ] **Step 1: Create callback route**

Create `frontend/src/app/api/auth/callback/route.ts`:

```ts
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
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach/frontend && npm run build 2>&1 | tail -10
```

Expected: build succeeds, `/api/auth/callback` appears in routes

- [ ] **Step 3: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add frontend/src/app/api/auth/callback/route.ts && git commit -m "feat: add auth callback route handler with Sentry tracing

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: User Context Hook with Sentry Identification

**Files:**
- Create: `frontend/src/hooks/use-user.ts`

Client-side hook that provides the current Supabase user and calls `Sentry.setUser()` when the user session is available.

- [ ] **Step 1: Create use-user hook**

Create `frontend/src/hooks/use-user.ts`:

```ts
"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import * as Sentry from "@sentry/nextjs"
import type { User } from "@supabase/supabase-js"

export function useUser() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    async function getUser() {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      setLoading(false)

      if (user) {
        Sentry.setUser({ id: user.id, email: user.email ?? undefined })
      } else {
        Sentry.setUser(null)
      }
    }

    getUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const sessionUser = session?.user ?? null
        setUser(sessionUser)

        if (sessionUser) {
          Sentry.setUser({ id: sessionUser.id, email: sessionUser.email ?? undefined })
        } else {
          Sentry.setUser(null)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  return { user, loading }
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach/frontend && npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add frontend/src/hooks/use-user.ts && git commit -m "feat: add useUser hook with Sentry user identification

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire Auth into Nav Bar + Sign Out

**Files:**
- Modify: `frontend/src/components/layout/app-nav.tsx` — use real user data
- Modify: `frontend/src/components/layout/user-menu.tsx` — add sign-out logic with Sentry

- [ ] **Step 1: Update user-menu with sign-out**

Update `frontend/src/components/layout/user-menu.tsx` — add sign-out handler that calls `supabase.auth.signOut()`, clears Sentry user, and redirects to `/`:

```tsx
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
    await supabase.auth.signOut()
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
```

- [ ] **Step 2: Update app-nav to use useUser hook**

Update `frontend/src/components/layout/app-nav.tsx` — replace hardcoded user with `useUser()`:

```tsx
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { KeychainLogo } from "./keychain-logo"
import { UserMenu } from "./user-menu"
import { useUser } from "@/hooks/use-user"
import { LayoutDashboard, GitBranch } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"

const NAV_ITEMS = [
  { href: "/dashboard", label: "Briefing", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", icon: GitBranch },
] as const

export function AppNav() {
  const pathname = usePathname()
  const { user, loading } = useUser()

  const displayName = user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "User"
  const displayEmail = user?.email ?? ""

  return (
    <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-white/10 bg-kc-charcoal px-6">
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
              <Icon className="h-4 w-4" aria-hidden={true} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Right: user menu */}
      {loading ? (
        <Skeleton className="h-7 w-24 bg-white/10" />
      ) : (
        <UserMenu name={displayName} email={displayEmail} />
      )}
    </header>
  )
}
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach/frontend && npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add frontend/src/components/layout/app-nav.tsx frontend/src/components/layout/user-menu.tsx && git commit -m "feat: wire real user data into nav, add sign-out with Sentry clear

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Login Page Auth Redirect (already authenticated)

**Files:**
- Modify: `frontend/src/app/page.tsx` — if user is already logged in, redirect to /dashboard

- [ ] **Step 1: Add server-side redirect for authenticated users**

Update `frontend/src/app/page.tsx` to check for an existing session and redirect:

```tsx
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { KeychainLogo } from "@/components/layout/keychain-logo"
import { SparkleIcon } from "@/components/layout/sparkle-icon"
import { GoogleLoginButton } from "@/components/auth/google-login-button"

export default async function LoginPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect("/dashboard")
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-kc-warm-white px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        {/* Logo */}
        <div className="space-y-3">
          <KeychainLogo size="lg" className="justify-center" />
          <p className="text-lg text-kc-text-muted">Outreach Tool</p>
        </div>

        {/* Login card */}
        <div className="rounded-xl border border-kc-warm-gray-dark bg-white p-8 shadow-sm">
          <h2 className="text-xl font-semibold text-kc-charcoal">
            Welcome back
          </h2>
          <p className="mt-2 text-sm text-kc-text-muted">
            Sign in with your @keychain.com account
          </p>
          <div className="mt-6">
            <GoogleLoginButton />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center gap-1.5 text-xs text-kc-text-muted">
          <SparkleIcon size={10} className="text-kc-gold/50" />
          <span>Powered by Keychain</span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach/frontend && npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add frontend/src/app/page.tsx && git commit -m "feat: redirect already-authenticated users from login to dashboard

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Stage 2 Review Checkpoint

- [ ] **Step 1: Build + test verification**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach/frontend && npm run build && npm test
```

- [ ] **Step 2: Visual verification**

Start dev server and verify:
- `http://localhost:3000` — Login page with Keychain logo, "Welcome back", Google sign-in button
- Clicking "Sign in with Google" initiates OAuth flow (may fail without Google Cloud setup — that's expected)
- `/dashboard` redirects to `/` when not authenticated

- [ ] **Step 3: Run skill reviews**

1. **`vercel:auth`** — verify auth integration patterns
2. **`vercel:routing-middleware`** — verify proxy.ts + callback interaction
3. **`vercel:react-best-practices`** — review new/modified TSX components
4. **`code-reviewer`** — security review on auth flow

- [ ] **Step 4: Fix any issues**

- [ ] **Step 5: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add -A && git commit -m "chore: Stage 2 complete — login page, auth callback, user session, sign-out

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Stage 2 Completion Checklist

- [ ] Login page renders with Keychain branding, Google button, and sparkle footer
- [ ] "Sign in with Google" calls `supabase.auth.signInWithOAuth` with Gmail+Calendar scopes
- [ ] `/api/auth/callback` exchanges code for session and redirects to `/dashboard`
- [ ] `useUser` hook provides user state and calls `Sentry.setUser()`
- [ ] Nav bar shows real user name/email from session (or skeleton while loading)
- [ ] Sign out clears Sentry user, calls `supabase.auth.signOut()`, redirects to `/`
- [ ] Already-authenticated users visiting `/` are redirected to `/dashboard`
- [ ] `npm run build` passes
- [ ] `npm test` passes
