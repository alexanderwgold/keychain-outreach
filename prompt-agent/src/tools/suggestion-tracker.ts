/**
 * suggestion-tracker MCP tool
 *
 * Persists prompt review results to prompt-review.json and loads them back
 * for apply mode.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import type { McpTool } from '../agent.js';
import { ReviewSchema } from './prompt-reviewer.js';

// ─── Output schema ──────────────────────────────────────────────────────────

export const PromptReviewOutputSchema = z.object({
  review_date: z.string(),
  files_scanned: z.number(),
  api_calls_found: z.number(),
  reviews: z.array(ReviewSchema),
  summary: z.object({
    critical_issues: z.number(),
    high_priority: z.number(),
    medium_priority: z.number(),
    low_priority: z.number(),
    top_themes: z.array(z.string()),
    overall_health: z.enum(['healthy', 'needs-work', 'critical']),
  }),
});

export type PromptReviewOutput = z.infer<typeof PromptReviewOutputSchema>;

// ─── save_review tool ───────────────────────────────────────────────────────

const SaveInputSchema = z.object({
  output_path: z
    .string()
    .describe('Absolute or project-relative path to write prompt-review.json'),
  reviews: z
    .array(ReviewSchema)
    .describe('All structured reviews accumulated during the scan'),
  files_scanned: z.number().describe('Number of TypeScript files scanned'),
  api_calls_found: z.number().describe('Total number of API calls extracted'),
});

type SaveInput = z.infer<typeof SaveInputSchema>;

async function saveReview(input: SaveInput): Promise<string> {
  const { output_path, reviews, files_scanned, api_calls_found } = input;

  let resolvedPath = output_path;
  if (!path.isAbsolute(output_path)) {
    resolvedPath = path.resolve(process.cwd(), '..', output_path);
  }

  // Build summary
  let criticalIssues = 0;
  let highPriority = 0;
  let mediumPriority = 0;
  let lowPriority = 0;
  const themeMap = new Map<string, number>();

  for (const review of reviews) {
    for (const suggestion of review.suggestions) {
      if (suggestion.priority === 'high') highPriority++;
      else if (suggestion.priority === 'medium') mediumPriority++;
      else lowPriority++;

      // Count theme occurrences
      const cat = suggestion.category;
      themeMap.set(cat, (themeMap.get(cat) ?? 0) + 1);
    }
    if (review.overall_score < 4) criticalIssues++;
  }

  // Top 3 themes by frequency
  const topThemes = Array.from(themeMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([theme]) => theme);

  const avgScore =
    reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.overall_score, 0) / reviews.length
      : 10;

  const overallHealth: 'healthy' | 'needs-work' | 'critical' =
    avgScore >= 7 ? 'healthy' : avgScore >= 4 ? 'needs-work' : 'critical';

  const output: PromptReviewOutput = {
    review_date: new Date().toISOString(),
    files_scanned,
    api_calls_found,
    reviews,
    summary: {
      critical_issues: criticalIssues,
      high_priority: highPriority,
      medium_priority: mediumPriority,
      low_priority: lowPriority,
      top_themes: topThemes,
      overall_health: overallHealth,
    },
  };

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, JSON.stringify(output, null, 2), 'utf-8');

  return JSON.stringify({
    success: true,
    path: resolvedPath,
    summary: output.summary,
  });
}

export const saveReviewTool: McpTool<typeof SaveInputSchema> = {
  name: 'save_review',
  serverName: 'suggestion_tracker',
  description:
    'Persists all accumulated prompt reviews to prompt-review.json. Call this after processing all files. Returns a summary of the findings.',
  inputSchema: SaveInputSchema,
  handler: saveReview,
};

// ─── load_reviews tool ──────────────────────────────────────────────────────

const LoadInputSchema = z.object({
  output_path: z
    .string()
    .describe('Path to the prompt-review.json file to load'),
  priority_filter: z
    .enum(['high', 'medium', 'low', 'all'])
    .optional()
    .describe('Filter suggestions by priority. Defaults to "all".'),
});

type LoadInput = z.infer<typeof LoadInputSchema>;

async function loadReviews(input: LoadInput): Promise<string> {
  const { output_path, priority_filter = 'all' } = input;

  let resolvedPath = output_path;
  if (!path.isAbsolute(output_path)) {
    resolvedPath = path.resolve(process.cwd(), '..', output_path);
  }

  if (!fs.existsSync(resolvedPath)) {
    return JSON.stringify({
      error: `No review file found at ${resolvedPath}. Run review mode first.`,
    });
  }

  const raw = fs.readFileSync(resolvedPath, 'utf-8');
  let data: PromptReviewOutput;
  try {
    data = PromptReviewOutputSchema.parse(JSON.parse(raw));
  } catch (e) {
    return JSON.stringify({
      error: `prompt-review.json at ${resolvedPath} failed schema validation: ${String(e)}`,
    });
  }

  // Filter to just the actionable suggestions
  const actionable: Array<{
    call_id: string;
    file: string;
    suggestion_index: number;
    priority: string;
    category: string;
    before: string;
    after: string;
    rationale: string;
  }> = [];

  for (const review of data.reviews) {
    for (let i = 0; i < review.suggestions.length; i++) {
      const sug = review.suggestions[i];
      if (!sug) continue;
      if (priority_filter !== 'all' && sug.priority !== priority_filter) continue;

      actionable.push({
        call_id: review.call_id,
        file: review.file,
        suggestion_index: i,
        priority: sug.priority,
        category: sug.category,
        before: sug.before,
        after: sug.after,
        rationale: sug.rationale,
      });
    }
  }

  // Sort: high → medium → low
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  actionable.sort(
    (a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2),
  );

  return JSON.stringify(
    {
      review_date: data.review_date,
      summary: data.summary,
      actionable_suggestions: actionable,
      total: actionable.length,
    },
    null,
    2,
  );
}

export const loadReviewsTool: McpTool<typeof LoadInputSchema> = {
  name: 'load_reviews',
  serverName: 'suggestion_tracker',
  description:
    'Loads the persisted prompt-review.json and returns actionable suggestions sorted by priority. Use in apply mode to get the list of changes to implement.',
  inputSchema: LoadInputSchema,
  handler: loadReviews,
};
