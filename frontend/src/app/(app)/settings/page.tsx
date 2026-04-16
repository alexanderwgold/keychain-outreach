import { createClient } from "@/lib/supabase/server"
import { StyleGuideForm } from "@/components/settings/style-guide-form"

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const repEmail = user?.email ?? ""

  // Load existing style guide
  const { data: styleGuide } = await supabase
    .from("rep_style_guides")
    .select("tone_and_voice, opening_style, closing_and_signoff, things_to_avoid, example_phrases, generated_from")
    .eq("rep_email", repEmail)
    .single()

  const initialData = styleGuide
    ? {
        toneAndVoice: styleGuide.tone_and_voice,
        openingStyle: styleGuide.opening_style,
        closingAndSignoff: styleGuide.closing_and_signoff,
        thingsToAvoid: styleGuide.things_to_avoid,
        examplePhrases: styleGuide.example_phrases,
        generatedFrom: styleGuide.generated_from as Record<string, unknown> | undefined,
      }
    : null

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-kc-charcoal">Settings</h1>
        <p className="mt-1 text-kc-text-muted">
          Manage your writing style and preferences
        </p>
      </div>

      <StyleGuideForm repEmail={repEmail} initialData={initialData} />
    </div>
  )
}
