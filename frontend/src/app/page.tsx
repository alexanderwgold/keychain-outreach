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
        <div className="space-y-3">
          <KeychainLogo size="lg" className="justify-center" />
          <p className="text-lg text-kc-text-muted">Outreach Tool</p>
        </div>

        <div className="rounded-xl border border-kc-warm-gray-dark bg-white p-8 shadow-sm">
          <h2 className="text-xl font-semibold text-kc-charcoal">Welcome back</h2>
          <p className="mt-2 text-sm text-kc-text-muted">Sign in with your @keychain.com account</p>
          <div className="mt-6">
            <GoogleLoginButton />
          </div>
        </div>

        <div className="flex items-center justify-center gap-1.5 text-xs text-kc-text-muted">
          <SparkleIcon size={10} className="text-kc-gold/50" />
          <span>Powered by Keychain</span>
        </div>
      </div>
    </div>
  )
}
