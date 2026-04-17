/**
 * api-call-extractor MCP tool
 *
 * Scans a TypeScript file and extracts every Claude API call, returning
 * a structured object for each one with all the information needed for
 * prompt quality review.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import type { McpTool } from '../agent.js';

export const ExtractedApiCallSchema = z.object({
  id: z.string().describe('Unique identifier like "daily-scan:call-1"'),
  file: z.string().describe('Relative file path'),
  lines: z.string().describe('Line range like "45-92"'),
  purpose: z.string().describe('Inferred purpose of this API call'),
  model: z.string().nullable().describe('Model string, or null if dynamic/unknown'),
  max_tokens: z.number().nullable().describe('max_tokens value, or null if not set'),
  temperature: z.number().nullable().describe('temperature value, or null if not set'),
  has_streaming: z.boolean().describe('Whether the call uses streaming'),
  thinking_config: z
    .object({ type: z.string(), budget_tokens: z.number().optional() })
    .nullable()
    .describe('Thinking config block, or null'),
  effort: z.string().nullable().describe('output_config.effort value, or null'),
  system_prompt: z.string().nullable().describe('Full system prompt text, or null if dynamic/absent'),
  system_has_cache_control: z.boolean().describe('Whether cache_control is set on the system prompt'),
  user_message_template: z.string().nullable().describe('The user message or template string'),
  variable_interpolation_points: z
    .array(z.string())
    .describe('Variable names interpolated into the prompts'),
  tool_definitions: z.array(z.string()).describe('Names of any tools declared in the API call'),
  business_context: z.string().describe('What triggers this call and what happens with the response'),
  raw_snippet: z.string().describe('The raw source code of the API call block'),
});

export type ExtractedApiCall = z.infer<typeof ExtractedApiCallSchema>;

const InputSchema = z.object({
  file_path: z.string().describe('Absolute or project-relative path to the TypeScript file to scan'),
});

type Input = z.infer<typeof InputSchema>;

/**
 * Patterns that signal a Claude API call in TypeScript/JavaScript.
 */
const API_CALL_PATTERNS = [
  /messages\.create\s*\(/,
  /messages\.stream\s*\(/,
  /client\.messages/,
  /anthropic\.messages/,
  /new Anthropic\s*\(/,
  /@anthropic-ai\/sdk/,
  /ANTHROPIC_API_KEY/,
  /claude-opus|claude-sonnet|claude-haiku/,
  /\/v1\/messages/,
];

function detectApiCallPatterns(content: string): boolean {
  return API_CALL_PATTERNS.some(p => p.test(content));
}

function extractLineRange(
  lines: string[],
  startIdx: number,
  openBrace: string,
  closeBrace: string,
): { content: string; endIdx: number } {
  let depth = 0;
  let started = false;
  let end = startIdx;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i] ?? '';
    let j = 0;
    let inString: null | "'" | '"' | '`' = null;

    while (j < line.length) {
      const ch = line[j]!;

      if (inString) {
        // Skip escaped characters inside strings
        if (ch === '\\') { j += 2; continue; }
        if (ch === inString) inString = null;
      } else {
        // Line comment — rest of line is irrelevant
        if (ch === '/' && line[j + 1] === '/') break;
        if (ch === "'" || ch === '"' || ch === '`') {
          inString = ch;
        } else if (ch === openBrace) {
          depth++;
          started = true;
        } else if (ch === closeBrace) {
          depth--;
        }
      }
      j++;
    }

    if (started && depth === 0) {
      end = i;
      break;
    }
  }

  return {
    content: lines.slice(startIdx, end + 1).join('\n'),
    endIdx: end,
  };
}

function extractStringValue(text: string, key: string): string | null {
  // Handles: model: "claude-sonnet-4-6" or model: `claude-sonnet-4-6`
  const patterns = [
    new RegExp(`${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`),
    new RegExp(`${key}:\\s*([A-Z_][A-Z_0-9]*)\\b`), // constants
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

function extractNumberValue(text: string, key: string): number | null {
  const m = text.match(new RegExp(`${key}\\s*:\\s*(\\d+)`));
  if (m?.[1]) return parseInt(m[1], 10);
  return null;
}

/**
 * Resolves `const <ident> = `...`` (or "..."/`'...'`) to the literal value.
 * Returns null if the identifier isn't found or is backed by an expression we
 * can't statically evaluate.
 */
function resolveIdentifier(fileSource: string, ident: string): string | null {
  // Match: const/let/var <ident> = `...` | "..." | '...'
  const pattern = new RegExp(
    `(?:const|let|var)\\s+${ident}\\s*(?::\\s*[^=]+)?=\\s*([\`"'])`,
    'm',
  );
  const m = fileSource.match(pattern);
  if (!m || m.index === undefined) return null;

  const quote = m[1]!;
  const start = m.index + m[0].length;
  // Walk forward to find the matching closing quote, honoring escapes.
  let i = start;
  while (i < fileSource.length) {
    const ch = fileSource[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) {
      return fileSource.slice(start, i);
    }
    i++;
  }
  return null;
}

function extractTemplateString(
  text: string,
  key: string,
  fileSource = '',
): string | null {
  // Try to find the value after a key in an object
  const idx = text.indexOf(key + ':');
  if (idx === -1) return null;

  const after = text.slice(idx + key.length + 1).trimStart();
  // backtick template literal
  if (after.startsWith('`')) {
    const end = after.indexOf('`', 1);
    if (end !== -1) return after.slice(1, end);
  }
  // double-quoted string
  if (after.startsWith('"')) {
    const end = after.indexOf('"', 1);
    if (end !== -1) return after.slice(1, end);
  }
  // single-quoted
  if (after.startsWith("'")) {
    const end = after.indexOf("'", 1);
    if (end !== -1) return after.slice(1, end);
  }
  // array (system: [...]) — return first text block content, resolving
  // identifier-backed values against the full file source.
  if (after.startsWith('[')) {
    const textMatch = after.match(/text\s*:\s*`([^`]+)`/s);
    if (textMatch?.[1]) return textMatch[1];
    const textMatch2 = after.match(/text\s*:\s*"([^"]+)"/s);
    if (textMatch2?.[1]) return textMatch2[1];
    // Identifier form: text: <ident>
    const textIdentMatch = after.match(/text\s*:\s*([A-Za-z_$][\w$]*)\b/);
    if (textIdentMatch?.[1] && fileSource) {
      const resolved = resolveIdentifier(fileSource, textIdentMatch[1]);
      if (resolved !== null) return resolved;
    }
  }
  // Identifier form at the top level: system: systemPrompt / content: userMessage
  const identMatch = after.match(/^([A-Za-z_$][\w$]*)\b/);
  if (identMatch?.[1] && fileSource) {
    const resolved = resolveIdentifier(fileSource, identMatch[1]);
    if (resolved !== null) return resolved;
  }
  return null;
}

function extractVariableInterpolations(text: string): string[] {
  const vars = new Set<string>();
  // Template literal interpolations: ${varName} or ${obj.prop} or ${fn()}
  for (const m of text.matchAll(/\$\{([^}]+)\}/g)) {
    if (m[1]) vars.add(m[1].trim());
  }
  // String concatenation patterns: "..." + varName + "..."
  for (const m of text.matchAll(/["']\s*\+\s*(\w+(?:\.\w+)*)\s*\+\s*["']/g)) {
    if (m[1]) vars.add(m[1].trim());
  }
  return Array.from(vars);
}

function extractToolNames(text: string): string[] {
  const names: string[] = [];
  // Match { name: "tool_name" } patterns inside a tools array
  for (const m of text.matchAll(/name\s*:\s*["'`]([^"'`]+)["'`]/g)) {
    if (m[1]) names.push(m[1]);
  }
  return names;
}

function inferPurpose(
  filePath: string,
  snippet: string,
  systemPrompt: string | null,
): string {
  const fileName = path.basename(path.dirname(filePath));
  const snipLower = snippet.toLowerCase();
  const sysLower = (systemPrompt ?? '').toLowerCase();

  if (snipLower.includes('follow') || sysLower.includes('follow-up')) {
    return 'Drafts a follow-up email after a meeting or touchpoint';
  }
  if (snipLower.includes('research') || sysLower.includes('research')) {
    return 'Research-enhanced draft: searches web for company/contact info and rewrites email';
  }
  if (snipLower.includes('value') || sysLower.includes('between-meeting')) {
    return 'Drafts a value-add touchpoint between meetings';
  }
  if (snipLower.includes('prep') || sysLower.includes('pre-meeting')) {
    return 'Drafts pre-meeting preparation email';
  }
  if (snipLower.includes('initial') || snipLower.includes('outreach')) {
    return 'Drafts initial outreach email for a new contact';
  }
  if (snipLower.includes('gong') || sysLower.includes('gong')) {
    return 'Drafts post-meeting follow-up based on Gong call summary';
  }
  if (snipLower.includes('reply') || sysLower.includes('reply')) {
    return 'Drafts suggested reply to a contact who responded';
  }
  return `Claude API call in ${fileName || path.basename(filePath)}`;
}

function extractApiCallsFromContent(
  content: string,
  filePath: string,
  projectRoot: string,
): ExtractedApiCall[] {
  const results: ExtractedApiCall[] = [];
  const lines = content.split('\n');
  const relPath = path.relative(projectRoot, filePath);

  // Find blocks that look like messages.create() or messages.stream() calls
  const callPatterns = [
    /messages\.create\s*\(/,
    /messages\.stream\s*\(/,
    /client\.messages/,
  ];

  const functionName = path.basename(path.dirname(filePath));
  let callIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const isCall = callPatterns.some(p => p.test(line));
    if (!isCall) continue;

    callIndex++;

    // Extract the full block by brace matching from this line
    const { content: snippet, endIdx } = extractLineRange(lines, i, '(', ')');

    const model = extractStringValue(snippet, 'model');
    const maxTokens = extractNumberValue(snippet, 'max_tokens');
    const temperature = extractNumberValue(snippet, 'temperature') ??
      (snippet.includes('temperature') ? null : null);

    // Thinking config
    let thinkingConfig: ExtractedApiCall['thinking_config'] = null;
    if (snippet.includes('thinking')) {
      const thinkingType = extractStringValue(snippet, 'type');
      const budgetTokens = extractNumberValue(snippet, 'budget_tokens');
      thinkingConfig = {
        type: thinkingType ?? 'unknown',
        ...(budgetTokens !== null ? { budget_tokens: budgetTokens } : {}),
      };
    }

    const effort = extractStringValue(snippet, 'effort');
    const systemPrompt = extractTemplateString(snippet, 'system', content);
    // Scope cache_control check to the system block only, not the whole snippet.
    // Extracts the ~500 chars after "system:" to cover the array/object value.
    const systemKeyIdx = snippet.indexOf('system:');
    const systemSection = systemKeyIdx !== -1 ? snippet.slice(systemKeyIdx, systemKeyIdx + 600) : '';
    const hasCacheControl =
      systemSection.includes('cache_control') || systemSection.includes('cacheControl');
    const userMessage = extractTemplateString(snippet, 'content', content) ??
      extractTemplateString(snippet, 'user', content);
    const variables = extractVariableInterpolations(snippet);
    const toolNames = extractToolNames(snippet);
    const hasStreaming = line.includes('.stream(') || snippet.includes('stream: true');

    const purpose = inferPurpose(filePath, snippet, systemPrompt);

    // Temperature: explicit null vs number
    let tempValue: number | null = null;
    const tempMatch = snippet.match(/temperature\s*:\s*([\d.]+)/);
    if (tempMatch?.[1]) tempValue = parseFloat(tempMatch[1]);

    results.push({
      id: `${functionName}:call-${callIndex}`,
      file: relPath,
      lines: `${i + 1}-${endIdx + 1}`,
      purpose,
      model,
      max_tokens: maxTokens,
      temperature: tempValue,
      has_streaming: hasStreaming,
      thinking_config: thinkingConfig,
      effort,
      system_prompt: systemPrompt,
      system_has_cache_control: hasCacheControl,
      user_message_template: userMessage,
      variable_interpolation_points: variables,
      tool_definitions: toolNames,
      business_context: purpose,
      raw_snippet: snippet,
    });

    // Skip to end of this call block
    i = endIdx;
  }

  return results;
}

async function extractCalls(input: Input): Promise<string> {
  const { file_path } = input;

  let resolvedPath = file_path;
  if (!path.isAbsolute(file_path)) {
    resolvedPath = path.resolve(process.cwd(), '..', file_path);
  }

  if (!fs.existsSync(resolvedPath)) {
    return JSON.stringify({ error: `File not found: ${resolvedPath}`, calls: [] });
  }

  const content = fs.readFileSync(resolvedPath, 'utf-8');

  if (!detectApiCallPatterns(content)) {
    return JSON.stringify({ calls: [], message: 'No Claude API patterns detected in this file' });
  }

  // Project root is one level up from prompt-agent/
  const projectRoot = path.resolve(process.cwd(), '..');
  const calls = extractApiCallsFromContent(content, resolvedPath, projectRoot);

  return JSON.stringify({ calls, total: calls.length }, null, 2);
}

export const apiCallExtractorTool: McpTool<typeof InputSchema> = {
  name: 'extract_calls',
  serverName: 'api_call_extractor',
  description:
    'Scans a TypeScript file and extracts every Claude API call with its full context: system prompt, user message template, model, max_tokens, temperature, thinking config, tool definitions, and business context. Returns a JSON array of structured ExtractedApiCall objects.',
  inputSchema: InputSchema,
  handler: extractCalls,
};
