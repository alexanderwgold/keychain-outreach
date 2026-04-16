import { createAdminClient } from "../_shared/supabase-client.ts";
import { corsPreflightResponse, jsonResponse } from "../_shared/cors.ts";

interface SaveRequest {
  repEmail: string;
  toneAndVoice: string;
  openingStyle: string;
  closingAndSignoff: string;
  thingsToAvoid: string;
  examplePhrases: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let body: SaveRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { repEmail, toneAndVoice, openingStyle, closingAndSignoff, thingsToAvoid, examplePhrases } = body;
  if (!repEmail) return jsonResponse({ error: "repEmail required" }, 400);

  try {
    const client = createAdminClient();

    const { error } = await client.from("rep_style_guides").upsert({
      rep_email: repEmail,
      tone_and_voice: toneAndVoice,
      opening_style: openingStyle,
      closing_and_signoff: closingAndSignoff,
      things_to_avoid: thingsToAvoid,
      example_phrases: examplePhrases,
    }, { onConflict: "rep_email" });

    if (error) {
      console.error("Style guide save failed:", error.message);
      return jsonResponse({ error: "Failed to save style guide" }, 500);
    }

    return jsonResponse({ success: true });
  } catch (e) {
    console.error("save-style-guide error:", (e as Error).message);
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
