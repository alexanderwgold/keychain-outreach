#!/usr/bin/env node
/**
 * Prompt engineering quality agent — entry point.
 *
 * Usage:
 *   npm run review                    # scan all Edge Functions, write prompt-review.json
 *   npm run review:file -- --file path/to/fn.ts
 *   npm run apply                     # load prompt-review.json, apply high-priority changes
 *
 * Flags:
 *   --mode review|apply               default: review
 *   --file <path>                     scan a single file instead of all Edge Functions
 *   --output-dir <path>               where to write prompt-review.json (default: project root)
 *   --priority high|medium|low|all    in apply mode, which suggestions to apply (default: high)
 */

import * as path from 'node:path';
import { query, createSdkMcpServer, type AgentEvent } from './agent.js';
import { AGENT_SYSTEM_PROMPT } from './prompt.js';
import { logSection, logAgentText, logToolCall } from './hooks.js';
import { apiCallExtractorTool } from './tools/api-call-extractor.js';
import { promptReviewerTool } from './tools/prompt-reviewer.js';
import { saveReviewTool, loadReviewsTool } from './tools/suggestion-tracker.js';

// ─── CLI arg parsing ────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  mode: 'review' | 'apply';
  file: string | null;
  outputDir: string;
  priority: 'high' | 'medium' | 'low' | 'all';
} {
  let mode: 'review' | 'apply' = 'review';
  let file: string | null = null;
  let outputDir = path.resolve(process.cwd(), '..');
  let priority: 'high' | 'medium' | 'low' | 'all' = 'high';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--mode' && argv[i + 1]) {
      const val = argv[++i];
      if (val === 'apply') mode = 'apply';
    } else if (arg === '--file' && argv[i + 1]) {
      file = argv[++i] ?? null;
    } else if (arg === '--output-dir' && argv[i + 1]) {
      outputDir = path.resolve(argv[++i] ?? '.');
    } else if (arg === '--priority' && argv[i + 1]) {
      const val = argv[++i];
      if (val === 'high' || val === 'medium' || val === 'low' || val === 'all') {
        priority = val;
      }
    }
  }

  return { mode, file, outputDir, priority };
}

// ─── Register MCP servers ───────────────────────────────────────────────────

const apiCallExtractorServer = createSdkMcpServer({
  serverName: 'api_call_extractor',
  tools: [apiCallExtractorTool],
});

const promptReviewerServer = createSdkMcpServer({
  serverName: 'prompt_reviewer',
  tools: [promptReviewerTool],
});

const suggestionTrackerServer = createSdkMcpServer({
  serverName: 'suggestion_tracker',
  tools: [saveReviewTool, loadReviewsTool],
});

// ─── Build task prompt ──────────────────────────────────────────────────────

function buildReviewPrompt(opts: {
  file: string | null;
  outputDir: string;
  projectRoot: string;
  edgeFunctionsDir: string;
}): string {
  const { file, outputDir, projectRoot, edgeFunctionsDir } = opts;
  const outputPath = path.join(outputDir, 'prompt-review.json');

  if (file) {
    const absFile = path.isAbsolute(file) ? file : path.resolve(projectRoot, file);
    return `REVIEW MODE — single file scan.

Project root: ${projectRoot}
File to scan: ${absFile}
Output: ${outputPath}

Your workflow:
1. Call mcp__api_call_extractor__extract_calls with file_path="${absFile}" to extract all Claude API calls
2. For each extracted call, call mcp__prompt_reviewer__review_call to get a structured critique
3. Call mcp__suggestion_tracker__save_review with all reviews, output_path="${outputPath}", files_scanned=1, and api_calls_found=<count>
4. Print a human-readable summary of what you found

If the file has no Claude API calls, say so clearly and exit.`;
  }

  return `REVIEW MODE — full codebase scan.

Project root: ${projectRoot}
Edge Functions directory: ${edgeFunctionsDir}
Output: ${outputPath}

Your workflow:
1. Use Glob with pattern="**/*.ts" and path="${edgeFunctionsDir}" to find all TypeScript files
2. For each file, use Grep with pattern="anthropic|messages\\.create|claude-|/v1/messages|@anthropic-ai/sdk|new Anthropic" to check if it contains Claude API calls
3. For each file that matches, call mcp__api_call_extractor__extract_calls with the absolute file path
4. For each extracted call, call mcp__prompt_reviewer__review_call
5. After processing all files, call mcp__suggestion_tracker__save_review with:
   - all accumulated reviews
   - output_path="${outputPath}"
   - files_scanned=<total files checked>
   - api_calls_found=<total calls extracted>
6. Print a clear, human-readable summary:
   - How many files scanned, how many had API calls
   - Top 3 most impactful issues found
   - Overall health rating
   - Where the full report was written

Be thorough. Read each system prompt carefully. Every suggestion must include exact before/after text.`;
}

function buildApplyPrompt(opts: {
  outputDir: string;
  projectRoot: string;
  priority: 'high' | 'medium' | 'low' | 'all';
}): string {
  const { outputDir, projectRoot, priority } = opts;
  const outputPath = path.join(outputDir, 'prompt-review.json');

  return `APPLY MODE — implement approved changes.

Project root: ${projectRoot}
Review file: ${outputPath}
Priority filter: ${priority}

Your workflow:
1. Call mcp__suggestion_tracker__load_reviews with output_path="${outputPath}" and priority_filter="${priority}"
2. For each actionable suggestion:
   a. Read the file at the given path (use Read tool)
   b. Verify the "before" text exists in the file
   c. Use the Edit tool to apply the exact replacement
   d. Log what you changed and why
3. After all edits, print a summary of changes made

Make precise, surgical edits. Do not refactor surrounding code. Only change what the suggestion specifies.
If the "before" text is not found verbatim, note it as skipped and continue.`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(process.cwd(), '..');
  const edgeFunctionsDir = path.join(projectRoot, 'supabase', 'functions');

  logSection(
    args.mode === 'review'
      ? `Prompt Quality Review${args.file ? ` — ${args.file}` : ' — Full Scan'}`
      : `Applying Changes (priority: ${args.priority})`,
  );

  const userMessage =
    args.mode === 'review'
      ? buildReviewPrompt({
          file: args.file,
          outputDir: args.outputDir,
          projectRoot,
          edgeFunctionsDir,
        })
      : buildApplyPrompt({
          outputDir: args.outputDir,
          projectRoot,
          priority: args.priority,
        });

  const allowedTools = [
    'Read',
    'Glob',
    'Grep',
    ...(args.mode === 'apply' ? ['Edit'] : []),
    'mcp__api_call_extractor__extract_calls',
    'mcp__prompt_reviewer__review_call',
    'mcp__suggestion_tracker__save_review',
    'mcp__suggestion_tracker__load_reviews',
  ];

  const stream = query({
    systemPrompt: AGENT_SYSTEM_PROMPT,
    userMessage,
    allowedTools,
    mcpServers: [apiCallExtractorServer, promptReviewerServer, suggestionTrackerServer],
    model: 'claude-opus-4-6',
    thinking: { type: 'adaptive' },
    effort: 'high',
    maxIterations: 60,
  });

  for await (const event of stream) {
    handleEvent(event);
  }

  console.log('\n');
  logSection('Done');
}

function handleEvent(event: AgentEvent): void {
  switch (event.type) {
    case 'text':
      if (event.text) logAgentText(event.text);
      break;
    case 'tool_call':
      logToolCall(event.toolName ?? '?', summarizeInput(event.toolInput));
      break;
    case 'tool_result':
      // Don't print raw tool results — they're often large JSON blobs
      // The agent will summarize what it found in its text output
      break;
    case 'done':
      if (event.finalText) logAgentText('\n' + event.finalText);
      break;
  }
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return String(input);
  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return '{}';
  // Show first key's value (usually the path or pattern)
  const firstKey = keys[0];
  if (!firstKey) return '{}';
  const firstVal = obj[firstKey];
  const preview = typeof firstVal === 'string' ? firstVal.slice(0, 80) : JSON.stringify(firstVal);
  return keys.length === 1 ? preview : `${preview} (+${keys.length - 1} more)`;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
