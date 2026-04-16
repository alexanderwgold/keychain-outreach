import { createAdminClient } from "../_shared/supabase-client.ts";
import { corsPreflightResponse, jsonResponse } from "../_shared/cors.ts";
import { requireSelf } from "../_shared/auth.ts";
import { searchKnowledge, upsertKnowledge, type KnowledgeChunk } from "../_shared/knowledge.ts";
import { buildSystemPrompt, buildUserPrompt, buildStyleBlock, type DraftContext, type StyleGuide } from "./prompt.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-6";

interface GenerateRequest {
  contactId: string;
  opportunityId: string;
  mode: "standard" | "enhanced";
  context?: {
    trigger?: "rep_initiated" | "auto_overdue" | "meeting_prep";
    meetingTitle?: string;
    meetingTime?: string;
    daysOverdue?: number;
    cadenceThreshold?: number;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let body: GenerateRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { contactId, opportunityId, mode } = body;
  const trigger = body.context?.trigger ?? "rep_initiated";

  if (!contactId || !opportunityId) {
    return jsonResponse({ error: "contactId and opportunityId required" }, 400);
  }

  try {
    const client = createAdminClient();
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return jsonResponse({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    // Step 1: Load contact + opportunity context
    const { data: opp, error: oppError } = await client
      .from("opportunities")
      .select("*, opportunity_contacts(contacts(*))")
      .eq("id", opportunityId)
      .single();
    if (oppError || !opp) return jsonResponse({ error: "Opportunity not found" }, 404);

    // Authorize: caller must be the rep who owns this opportunity
    const forbid = await requireSelf(req, opp.rep_email);
    if (forbid) return forbid;

    // Style guide gate: require rep to have a style guide before generating
    const { data: styleGuide } = await client
      .from("rep_style_guides")
      .select("tone_and_voice, opening_style, closing_and_signoff, things_to_avoid, example_phrases")
      .eq("rep_email", opp.rep_email)
      .single();

    if (!styleGuide) {
      return jsonResponse({ error: "style_guide_required", code: "NO_STYLE_GUIDE" }, 422);
    }

    // Find the specific contact
    const allContacts = (opp.opportunity_contacts ?? [])
      .map((oc: { contacts: unknown }) => oc.contacts)
      .flat();
    const contact = allContacts.find((c: { id: string }) => c.id === contactId);
    if (!contact) return jsonResponse({ error: "Contact not found on this opportunity" }, 404);

    // Get cadence rule for stage
    const { data: cadenceRule } = await client
      .from("cadence_rules")
      .select("suggested_action, days_between_touches")
      .eq("stage_name", opp.stage_name)
      .single();

    // Get recent activity
    const { data: recentActivity } = await client
      .from("activity_log")
      .select("activity_type, activity_date, subject")
      .eq("opportunity_id", opportunityId)
      .order("activity_date", { ascending: false })
      .limit(5);

    // Step 2: Query knowledge base
    const knowledgeResults = await searchKnowledge(
      client,
      opp.account_name,
      `${opp.account_name} ${contact.title ?? ""} manufacturing sourcing`,
      10
    );

    // Step 3: If enhanced mode, do web research
    if (mode === "enhanced") {
      // Check rate limit: 20 enhanced calls per rep per day
      const today = new Date().toISOString().split("T")[0];
      const { count } = await client
        .from("activity_log")
        .select("*", { count: "exact", head: true })
        .eq("rep_email", opp.rep_email)
        .eq("source", "manual")
        .gte("activity_date", `${today}T00:00:00`)
        .like("notes", "%enhanced_draft%");

      if ((count ?? 0) >= 20) {
        return jsonResponse({ error: "Enhanced draft rate limit reached (20/day)" }, 429);
      }

      // Call Claude with web_search tool
      const researchResponse = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2048,
          tools: [{
            type: "web_search_20250305",
            name: "web_search",
          }],
          messages: [{
            role: "user",
            content: `Search for recent news, announcements, and industry developments about "${opp.account_name}" in the manufacturing/sourcing space. Focus on the last 30 days. Summarize the most relevant findings in 2-3 paragraphs.`,
          }],
        }),
      });

      if (researchResponse.ok) {
        const researchData = await researchResponse.json();
        const textBlocks = researchData.content?.filter(
          (b: { type: string }) => b.type === "text"
        ) ?? [];
        const researchText = textBlocks.map((b: { text: string }) => b.text).join("\n");

        if (researchText) {
          // Store research in knowledge base for future standard drafts
          const chunks: KnowledgeChunk[] = [{
            sourceType: "web_research",
            sourceId: `research_${opp.account_name}_${today}`,
            accountName: opp.account_name,
            content: researchText,
            metadata: { query: opp.account_name, date: today },
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          }];
          await upsertKnowledge(client, chunks);

          // Add to knowledge results for this draft
          knowledgeResults.push({
            id: "live-research",
            source_type: "web_research",
            source_id: `research_${opp.account_name}_${today}`,
            account_name: opp.account_name,
            content: researchText,
            metadata: {},
            similarity: 1.0,
          });
        }
      }
    }

    // Step 4: Build prompts
    const draftContext: DraftContext = {
      contactName: `${contact.first_name} ${contact.last_name}`,
      contactTitle: contact.title,
      contactEmail: contact.email,
      accountName: opp.account_name,
      stageName: opp.stage_name ?? "Unknown",
      amount: opp.amount ? parseFloat(opp.amount) : null,
      closeDate: opp.close_date,
      suggestedAction: cadenceRule?.suggested_action ?? null,
      recentActivity: (recentActivity ?? []).map((a: { activity_type: string; activity_date: string; subject: string | null }) => ({
        type: a.activity_type,
        date: new Date(a.activity_date).toLocaleDateString(),
        subject: a.subject,
      })),
      knowledgeContext: knowledgeResults.map((k) => ({
        content: k.content,
        source_type: k.source_type,
      })),
      trigger,
      meetingTitle: body.context?.meetingTitle,
      meetingTime: body.context?.meetingTime,
      daysOverdue: body.context?.daysOverdue,
      cadenceThreshold: body.context?.cadenceThreshold,
    };

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(draftContext);

    // Step 5: Call Claude to generate draft
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: [
          {
            type: "text",
            text: systemPrompt,
            cache_control: { type: "ephemeral" },
          },
          ...(buildStyleBlock(styleGuide as StyleGuide)
            ? [{
                type: "text" as const,
                text: buildStyleBlock(styleGuide as StyleGuide)!,
                cache_control: { type: "ephemeral" as const },
              }]
            : []),
        ],
        messages: [{
          role: "user",
          content: userPrompt,
        }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Claude API error:", text);
      return jsonResponse({ error: "Draft generation failed" }, 502);
    }

    const data = await response.json();
    const textContent = data.content?.find((b: { type: string }) => b.type === "text");
    if (!textContent) {
      return jsonResponse({ error: "No text in Claude response" }, 502);
    }

    // Parse JSON from Claude's response
    let draft: { subject: string; htmlBody: string };
    try {
      // Claude may wrap JSON in markdown code blocks
      const jsonStr = textContent.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      draft = JSON.parse(jsonStr);
    } catch {
      // If JSON parsing fails, use the raw text as the body
      draft = {
        subject: `Follow up — ${opp.account_name}`,
        htmlBody: `<p>${textContent.text}</p>`,
      };
    }

    // Log the draft generation
    await client.from("activity_log").insert({
      opportunity_id: opportunityId,
      contact_id: contactId,
      rep_email: opp.rep_email,
      activity_type: "manual_log",
      activity_date: new Date().toISOString(),
      subject: draft.subject,
      notes: JSON.stringify({ trigger, mode, enhanced_draft: mode === "enhanced" }),
      source: "manual",
    });

    return jsonResponse({
      subject: draft.subject,
      htmlBody: draft.htmlBody,
      mode,
      knowledgeSourcesUsed: knowledgeResults.length,
    });
  } catch (e) {
    console.error("generate-draft error:", (e as Error).message);
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
