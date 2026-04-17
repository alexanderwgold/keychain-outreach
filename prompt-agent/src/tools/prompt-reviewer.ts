/**
 * prompt-reviewer MCP tool
 *
 * Takes a structured ExtractedApiCall object and produces a rigorous critique
 * against Anthropic best practices, copy quality standards, and payload config.
 */

import { z } from 'zod';
import type { McpTool } from '../agent.js';
import { ExtractedApiCallSchema, type ExtractedApiCall } from './api-call-extractor.js';

const RatingSchema = z.enum(['strong', 'adequate', 'weak', 'missing']);
type Rating = z.infer<typeof RatingSchema>;

export const SuggestionSchema = z.object({
  id: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  category: z.enum([
    'clarity',
    'best_practices',
    'copy_quality',
    'payload_config',
    'variable_handling',
  ]),
  description: z.string(),
  before: z.string(),
  after: z.string(),
  rationale: z.string(),
});

export const ReviewSchema = z.object({
  id: z.string(),
  call_id: z.string(),
  file: z.string(),
  lines: z.string(),
  purpose: z.string(),
  model: z.string().nullable(),
  overall_score: z.number().min(1).max(10),
  criteria: z.object({
    clarity: RatingSchema,
    best_practices: RatingSchema,
    copy_quality: RatingSchema,
    payload_config: RatingSchema,
    variable_handling: RatingSchema,
  }),
  suggestions: z.array(SuggestionSchema),
  status: z.literal('reviewed'),
});

export type Review = z.infer<typeof ReviewSchema>;
export type Suggestion = z.infer<typeof SuggestionSchema>;

const InputSchema = z.object({
  api_call: z
    .string()
    .describe('JSON string of an ExtractedApiCall object from the api-call-extractor tool'),
  review_id: z.string().describe('Unique ID for this review, e.g. "REVIEW-001"'),
  suggestion_id_start: z
    .number()
    .describe('Starting number for suggestion IDs, e.g. 1 → generates SUG-001, SUG-002, etc.'),
});

type Input = z.infer<typeof InputSchema>;

// ─── Rating helpers ───────────────────────────────────────────────────────────

const AI_SOUNDING_PHRASES = [
  'i hope this finds you well',
  'i hope this email finds you',
  'please find attached',
  'as per our conversation',
  "don't hesitate to reach out",
  'please feel free to',
  'i wanted to reach out',
  'i am writing to',
  'furthermore',
  'in conclusion',
  'to summarize',
  'in summary',
  'as mentioned',
  'please let me know if you have any questions',
  'looking forward to hearing from you',
];

const GOOD_PRACTICES = [
  { key: 'xml_tags', label: 'Uses XML tags to structure instructions', check: (s: string) => /<\w+>/.test(s) },
  {
    key: 'explicit_format',
    label: 'Output format explicitly defined',
    check: (s: string) =>
      /format|output|structure|respond with|return a|write a/i.test(s),
  },
  {
    key: 'tone_instruction',
    label: 'Explicit tone/voice instruction',
    check: (s: string) => /tone|voice|conversational|professional|warm|friendly|human/i.test(s),
  },
  {
    key: 'no_em_dash',
    label: 'Instructs against em dashes',
    check: (s: string) => /em dash|—|en dash/i.test(s),
  },
  {
    key: 'anti_ai_patterns',
    label: 'Guards against AI-sounding phrases',
    check: (s: string) =>
      /hope this finds|don't hesitate|furthermore|in conclusion|i am writing/i.test(s) &&
      /avoid|never|do not|don't/i.test(s),
  },
  {
    key: 'persona_context',
    label: 'Sets role/persona for Claude',
    check: (s: string) => /you are|your role|act as|you're/i.test(s),
  },
  {
    key: 'examples',
    label: 'Includes examples of good output',
    check: (s: string) =>
      /example|e\.g\.|for instance|such as|like:/i.test(s) &&
      /email|copy|message|subject/i.test(s),
  },
  {
    key: 'recipient_context',
    label: 'Injects recipient-specific context',
    check: (s: string) =>
      /contact|recipient|company|title|stage|opportunity/i.test(s),
  },
];

function rateClarity(call: ExtractedApiCall): { rating: Rating; issues: string[] } {
  const issues: string[] = [];
  const sys = call.system_prompt ?? '';
  const user = call.user_message_template ?? '';
  const combined = sys + ' ' + user;

  if (!sys && !user) {
    issues.push('No system prompt or user message found — cannot evaluate clarity');
    return { rating: 'missing', issues };
  }

  if (!sys) issues.push('No system prompt set — all instructions in user message');
  if (sys.length < 200) issues.push('System prompt is very short and likely underspecified');
  if (!/output|format|structure|write|generate|draft/i.test(combined)) {
    issues.push('No explicit instruction about what output is expected');
  }
  if (/don't|do not|never|avoid/i.test(combined) && !/\bdo\b.{0,50}\binstead\b/i.test(combined)) {
    issues.push('Uses negative instructions without affirmative alternatives (tell Claude what TO do)');
  }

  if (issues.length === 0) return { rating: 'strong', issues };
  if (issues.length === 1) return { rating: 'adequate', issues };
  if (issues.length === 2) return { rating: 'weak', issues };
  return { rating: 'missing', issues };
}

function rateBestPractices(call: ExtractedApiCall): { rating: Rating; issues: string[] } {
  const issues: string[] = [];
  const sys = call.system_prompt ?? '';

  const passedPractices = GOOD_PRACTICES.filter(p => p.check(sys));
  const failedPractices = GOOD_PRACTICES.filter(p => !p.check(sys));

  for (const f of failedPractices) {
    issues.push(`Missing: ${f.label}`);
  }

  // Additional payload-level checks that must count toward the score —
  // without this, a call with missing cache_control or deprecated thinking
  // could still rate "strong" on GOOD_PRACTICES alone, inflating the
  // overall_score and hiding real violations.
  const isOpus = call.model?.includes('opus') ?? false;
  const extraChecks: Array<{ label: string; passed: boolean; issue?: string }> = [
    {
      label: 'Adaptive thinking configured for Opus',
      // Only applies when the model is Opus; non-Opus calls trivially pass.
      passed: !isOpus || call.thinking_config !== null,
      issue: 'Adaptive thinking not configured — recommended for Opus on complex copy tasks',
    },
    {
      label: 'Not using deprecated budget_tokens thinking',
      passed: !(
        call.thinking_config?.type === 'enabled' &&
        call.thinking_config.budget_tokens !== undefined
      ),
      issue:
        'Using deprecated budget_tokens thinking config — switch to { type: "adaptive" } for claude-opus-4-6 / claude-sonnet-4-6',
    },
    {
      label: 'cache_control set on system prompt',
      // Trivially passes when there is no system prompt to cache.
      passed: sys.length === 0 || call.system_has_cache_control,
      issue:
        'System prompt has no cache_control — every Claude API call that sends product context must add { type: "ephemeral" }',
    },
  ];

  for (const c of extraChecks) {
    if (!c.passed && c.issue) issues.push(c.issue);
  }

  const passedExtra = extraChecks.filter(c => c.passed).length;
  const totalChecks = GOOD_PRACTICES.length + extraChecks.length;
  const score = (passedPractices.length + passedExtra) / totalChecks;

  if (score >= 0.8) return { rating: 'strong', issues };
  if (score >= 0.5) return { rating: 'adequate', issues };
  if (score >= 0.25) return { rating: 'weak', issues };
  return { rating: 'missing', issues };
}

function rateCopyQuality(call: ExtractedApiCall): { rating: Rating; issues: string[] } {
  const issues: string[] = [];
  const sys = call.system_prompt ?? '';
  const user = call.user_message_template ?? '';
  const combined = sys + ' ' + user;

  const hasHumanTone = /human|conversational|warm|friendly|colleague|thoughtful/i.test(sys);
  const hasNoPunctIssue =
    /em dash|—|proper punctuation|no em dash/i.test(sys);
  const hasAntiAI = AI_SOUNDING_PHRASES.some(phrase =>
    sys.toLowerCase().includes(phrase.slice(0, 15)),
  );
  const hasStyleGuard =
    /avoid|never|do not|don't/i.test(sys) &&
    /AI.sounding|generic|template|formulaic|boilerplate/i.test(sys);
  const hasExamples = /example|such as|like:/i.test(sys);
  const hasContactContext =
    call.variable_interpolation_points.length > 2 ||
    /contact|name|company|title|stage/i.test(combined);

  if (!hasHumanTone) issues.push('No instruction to write in a human, conversational tone');
  if (!hasNoPunctIssue) issues.push('No explicit punctuation guidance (no em dashes, proper punctuation)');
  if (!hasAntiAI && !hasStyleGuard) {
    issues.push('No guardrails against AI-sounding patterns or generic filler phrases');
  }
  if (!hasExamples) {
    issues.push('No example copy to anchor the desired style — examples dramatically improve output quality');
  }
  if (!hasContactContext) {
    issues.push('Insufficient recipient context injected — output may feel generic');
  }

  if (issues.length === 0) return { rating: 'strong', issues };
  if (issues.length <= 1) return { rating: 'adequate', issues };
  if (issues.length <= 3) return { rating: 'weak', issues };
  return { rating: 'missing', issues };
}

function ratePayloadConfig(call: ExtractedApiCall): { rating: Rating; issues: string[] } {
  const issues: string[] = [];

  // Model check
  const validModels = ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'];
  if (!call.model) {
    issues.push('Model string not found — verify it is set and not dynamic');
  } else if (!validModels.includes(call.model)) {
    issues.push(
      `Model "${call.model}" may be outdated — latest is claude-opus-4-6 / claude-sonnet-4-6 / claude-haiku-4-5`,
    );
  }

  // max_tokens check
  if (call.max_tokens === null) {
    issues.push('max_tokens not set — will use model default, risking truncation');
  } else if (call.max_tokens < 500 && !call.purpose.toLowerCase().includes('classif')) {
    issues.push(`max_tokens=${call.max_tokens} seems low for email drafting — consider 1500-2500`);
  } else if (call.max_tokens > 8000) {
    issues.push(
      `max_tokens=${call.max_tokens} is very high for email copy — 2000-4000 is sufficient and cheaper`,
    );
  }

  // Temperature check
  if (call.temperature !== null && call.temperature > 1.0) {
    issues.push(
      `temperature=${call.temperature} is very high — for email copy, 0.7-0.9 balances creativity with coherence`,
    );
  }
  if (call.temperature === 0) {
    issues.push(
      'temperature=0 produces deterministic output — for email copy, 0.7-0.9 is usually better',
    );
  }

  // Cache control — required whenever a system prompt is present (CLAUDE.md policy)
  if (call.system_prompt && !call.system_has_cache_control) {
    issues.push(
      'System prompt lacks cache_control — every Claude API call with product context must use { type: "ephemeral" }',
    );
  }

  if (issues.length === 0) return { rating: 'strong', issues };
  if (issues.length === 1) return { rating: 'adequate', issues };
  if (issues.length === 2) return { rating: 'weak', issues };
  return { rating: 'missing', issues };
}

function rateVariableHandling(call: ExtractedApiCall): { rating: Rating; issues: string[] } {
  const issues: string[] = [];
  const vars = call.variable_interpolation_points;

  if (vars.length === 0) {
    issues.push('No variable interpolation detected — output will be entirely generic');
  }

  const hasContactName =
    vars.some(v => /name|first|contact/i.test(v)) ||
    /contact\.name|firstName|first_name/i.test(call.user_message_template ?? '');
  const hasCompany =
    vars.some(v => /company|account|org/i.test(v)) ||
    /company|account/i.test(call.user_message_template ?? '');
  const hasStage =
    vars.some(v => /stage|opp/i.test(v)) ||
    /stage|opportunity/i.test(call.user_message_template ?? '');

  if (!hasContactName) issues.push('Contact name not injected — emails will feel cold and generic');
  if (!hasCompany) issues.push('Company name not injected — critical for personalization');
  if (!hasStage) issues.push('Opportunity stage not injected — copy cannot be stage-appropriate');

  // Prompt injection risk: check for direct interpolation without apparent sanitization
  const rawInterpolation = vars.filter(v => /\.notes|\.description|\.next_step|\.body/i.test(v));
  if (rawInterpolation.length > 0) {
    issues.push(
      `Potentially unsanitized user-controlled data interpolated directly: ${rawInterpolation.join(', ')} — strip control characters and validate length before injecting`,
    );
  }

  if (issues.length === 0) return { rating: 'strong', issues };
  if (issues.length === 1) return { rating: 'adequate', issues };
  if (issues.length === 2) return { rating: 'weak', issues };
  return { rating: 'missing', issues };
}

function computeOverallScore(criteria: Review['criteria']): number {
  const weights: Record<string, number> = {
    copy_quality: 3,
    best_practices: 2,
    clarity: 2,
    variable_handling: 2,
    payload_config: 1,
  };
  const ratingValues: Record<Rating, number> = {
    strong: 10,
    adequate: 6,
    weak: 3,
    missing: 0,
  };

  let totalWeight = 0;
  let weightedScore = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const rating = criteria[key as keyof typeof criteria];
    weightedScore += ratingValues[rating] * weight;
    totalWeight += weight;
  }

  return Math.round(weightedScore / totalWeight);
}

function buildSuggestions(
  call: ExtractedApiCall,
  clarityIssues: string[],
  bpIssues: string[],
  copyIssues: string[],
  payloadIssues: string[],
  varIssues: string[],
  startIdx: number,
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  let idx = startIdx;

  const pad = (n: number) => String(n).padStart(3, '0');
  const id = () => `SUG-${pad(idx++)}`;

  const sys = call.system_prompt ?? '';
  const rawSnippet = call.raw_snippet ?? '';

  // Apply mode requires `before` to appear verbatim in the source file. A
  // suggestion whose `before` isn't present in raw_snippet won't apply, so we
  // downgrade its priority instead of letting apply mode silently skip it.
  const appliable = (before: string): 'high' | 'medium' | 'low' =>
    before && rawSnippet.includes(before) ? 'high' : 'medium';

  // Copy quality suggestions — highest impact for this project
  if (!/human|conversational|warm|friendly|colleague|thoughtful/i.test(sys)) {
    const tonePrefix = `You are a sales rep at Keychain drafting outreach on behalf of your colleague. Write in a warm, professional tone as if you are a real person who has done their homework on this company and contact. Never use em dashes. Avoid AI-sounding phrases like "I hope this finds you well", "furthermore", "in conclusion", "I wanted to reach out", or "don't hesitate to reach out". The email should read like it was written by a thoughtful colleague, not generated by software.`;
    const before = sys;
    const after = sys ? `${tonePrefix}\n\n${sys}` : tonePrefix;
    suggestions.push({
      id: id(),
      priority: appliable(before),
      category: 'copy_quality',
      description: 'Add explicit tone, punctuation, and anti-AI-pattern instructions to the system prompt',
      before,
      after,
      rationale:
        "Without explicit tone guidance, Claude defaults to generic professional patterns that sound obviously AI-generated. Anthropic's best practices recommend being specific about desired output style. Explicitly naming anti-patterns (em dashes, 'furthermore', 'I hope this finds you well') is more effective than a general instruction to 'sound human'.",
    });
  }

  if (!/example|such as|like:/i.test(sys) && sys) {
    const examples = `<examples>
<good_example>
Subject: 494 brands found your site last month, none knew who to contact

Hi {{contact_first_name}},

Saw {{account_name}} is expanding into the {{category}} space, good timing given how fast the market is moving.

We've been working with similar manufacturers to surface the brands searching their categories on Keychain. For one client, we identified 494 invisible visitors in a single month, none of whom they could have found through traditional prospecting.

Worth a 20-minute call to see if the numbers look similar for you?

{{rep_name}}
</good_example>

<bad_example>
Hi {{contact_first_name}},

I hope this email finds you well. I wanted to reach out to introduce myself and discuss how Keychain can help {{account_name}} with its sales goals. We have a variety of features that I believe would be beneficial for your business. Don't hesitate to reach out if you have any questions.

Best regards,
{{rep_name}}
</bad_example>
</examples>`;
    const before = sys;
    const after = `${sys}\n\n${examples}`;
    suggestions.push({
      id: id(),
      priority: appliable(before),
      category: 'copy_quality',
      description: 'Add 2-3 concrete examples of good and bad copy to anchor the style',
      before,
      after,
      rationale:
        "Anthropic's best practice for creative/style-dependent tasks is to provide 3-5 diverse examples that anchor the desired output. Examples are especially important when the quality bar is nuanced (warm but professional, human but efficient). Without examples, Claude will drift toward safe, generic patterns. Variable names are template placeholders (e.g. {{contact_first_name}}) — swap to the identifiers used in the actual call site.",
    });
  }

  // Best practices suggestions
  if (sys.length > 0 && !call.system_has_cache_control) {
    // The exact source text varies (text: systemPrompt vs text: `literal`),
    // so this is a pattern change the reviewer should describe rather than
    // auto-apply. Keep priority medium to stay out of apply mode's default
    // high-priority filter.
    suggestions.push({
      id: id(),
      priority: 'medium',
      category: 'best_practices',
      description: 'Add cache_control to the system prompt block to reduce API costs',
      before: '',
      after: '',
      rationale:
        "The system prompt is the same for all reps and all contacts (it describes tone, style, and product context). Add cache_control: { type: 'ephemeral' } to the system block so subsequent calls pay ~0.1x the input token cost for the cached portion. With 25+ reps getting multiple drafts per day, this can reduce API costs by 60-80%. Edit the `system:` block at the call site to include `cache_control: { type: 'ephemeral' }` alongside the existing `type` and `text` fields.",
    });
  }

  if (
    call.thinking_config?.type === 'enabled' &&
    call.thinking_config.budget_tokens !== undefined
  ) {
    const before = `thinking: { type: "enabled", budget_tokens: ${call.thinking_config.budget_tokens} }`;
    const after = `thinking: { type: "adaptive" }`;
    suggestions.push({
      id: id(),
      priority: appliable(before),
      category: 'best_practices',
      description: 'Replace deprecated budget_tokens thinking config with adaptive thinking',
      before,
      after,
      rationale:
        'budget_tokens is deprecated on claude-opus-4-6 and claude-sonnet-4-6. The adaptive thinking mode lets Claude decide when and how much to think per request, which typically produces better results at lower average cost than a fixed budget.',
    });
  }

  if (!/<\w+>/.test(sys) && sys.length > 300) {
    // Describe as a refactor rather than a surgical edit — the entire
    // system prompt body would need rewriting, which isn't safe to auto-apply.
    suggestions.push({
      id: id(),
      priority: 'medium',
      category: 'best_practices',
      description: 'Use XML tags to separate instructions, context, and variable inputs in the system prompt',
      before: '',
      after: '',
      rationale:
        "Anthropic's best practice is to use XML tags (<role>, <product_context>, <tone_guidelines>, <output_format>) to clearly separate different types of instructions. This helps Claude parse role, context, constraints, and output format independently, reducing confusion and improving adherence to each instruction. Restructure the system prompt manually — auto-apply is unsafe here because it would rewrite the entire prompt body.",
    });
  }

  // Payload config suggestions
  if (
    call.max_tokens !== null &&
    (call.max_tokens < 800 || call.max_tokens > 6000)
  ) {
    const recommended = 2500;
    const before = `max_tokens: ${call.max_tokens}`;
    const after = `max_tokens: ${recommended}`;
    suggestions.push({
      id: id(),
      priority: appliable(before),
      category: 'payload_config',
      description: `Set max_tokens to ${recommended} for email drafting (2-3 variants under 150 words each)`,
      before,
      after,
      rationale:
        `For 2-3 short email variants (~150 words each), max_tokens=${recommended} gives ample room without wasting tokens. The current value of ${call.max_tokens} is ${call.max_tokens < 800 ? 'too low and may truncate mid-draft' : 'unnecessarily high and costs more than needed'}.`,
    });
  }

  // Variable handling suggestions
  if (call.variable_interpolation_points.length === 0) {
    // Use template placeholders instead of inventing specific identifiers —
    // the call site's actual variable names (first_name vs firstName, etc.)
    // must be filled in manually before applying.
    suggestions.push({
      id: id(),
      priority: 'medium',
      category: 'variable_handling',
      description: 'Inject contact-specific context into the user message: name, title, company, stage, and recent activity',
      before: '',
      after: `Draft a personalized outreach email for the following contact:

<contact>
Name: {{contact_first_name}} {{contact_last_name}}
Title: {{contact_title}}
Company: {{account_name}}
</contact>

<opportunity>
Stage: {{stage_name}}
Prior next steps: {{next_step}}
Description: {{description}}
</opportunity>

<activity>
Last touch: {{days_since_last_touch}} days ago ({{last_activity_type}})
Total prior touches: {{total_touches}}
</activity>`,
      rationale:
        "Without injecting contact-specific data, Claude can only produce generic copy. The more context Claude has about the specific recipient, the more tailored the output. At minimum: name, title, company, opportunity stage, and days since last touch. The {{...}} tokens are placeholders — substitute each with the actual identifiers used at the call site before applying.",
    });
  }

  return suggestions;
}

async function reviewCall(input: Input): Promise<string> {
  const { api_call, review_id, suggestion_id_start } = input;

  let call: ExtractedApiCall;
  try {
    call = ExtractedApiCallSchema.parse(JSON.parse(api_call));
  } catch (e) {
    return JSON.stringify({ error: `Failed to parse or validate api_call: ${String(e)}` });
  }

  const { rating: clarityRating, issues: clarityIssues } = rateClarity(call);
  const { rating: bpRating, issues: bpIssues } = rateBestPractices(call);
  const { rating: copyRating, issues: copyIssues } = rateCopyQuality(call);
  const { rating: payloadRating, issues: payloadIssues } = ratePayloadConfig(call);
  const { rating: varRating, issues: varIssues } = rateVariableHandling(call);

  const criteria: Review['criteria'] = {
    clarity: clarityRating,
    best_practices: bpRating,
    copy_quality: copyRating,
    payload_config: payloadRating,
    variable_handling: varRating,
  };

  const overallScore = computeOverallScore(criteria);

  const suggestions = buildSuggestions(
    call,
    clarityIssues,
    bpIssues,
    copyIssues,
    payloadIssues,
    varIssues,
    suggestion_id_start,
  );

  const review: Review = {
    id: review_id,
    call_id: call.id,
    file: call.file,
    lines: call.lines,
    purpose: call.purpose,
    model: call.model,
    overall_score: overallScore,
    criteria,
    suggestions,
    status: 'reviewed',
  };

  return JSON.stringify(review, null, 2);
}

export const promptReviewerTool: McpTool<typeof InputSchema> = {
  name: 'review_call',
  serverName: 'prompt_reviewer',
  description:
    'Takes a JSON string of an ExtractedApiCall and produces a structured prompt quality review. Evaluates clarity, Anthropic best practices, copy quality, payload configuration, and variable handling. Returns a Review object with an overall score (1-10), per-criterion ratings, and specific before/after suggestions.',
  inputSchema: InputSchema,
  handler: reviewCall,
};
