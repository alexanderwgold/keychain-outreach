/**
 * Core agent runner.
 *
 * Implements:
 *   - McpTool<T> — the interface all custom MCP tools must conform to
 *   - createSdkMcpServer — wraps a set of McpTool definitions into an in-process MCP server
 *   - query — async generator that drives the agentic loop using @anthropic-ai/sdk
 *   - Built-in tool implementations: Read, Glob, Grep, Edit, Write, Bash
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import { z } from 'zod';
import { logRead, logGlob, logGrep, logEdit, logToolCall } from './hooks.js';

// ─── McpTool interface ──────────────────────────────────────────────────────

export interface McpTool<TSchema extends z.ZodTypeAny> {
  name: string;
  serverName: string;
  description: string;
  inputSchema: TSchema;
  handler: (input: z.infer<TSchema>) => Promise<string>;
}

// ─── MCP server registry ────────────────────────────────────────────────────

/**
 * Stored form of an McpTool once it's been registered. Typing `handler`'s
 * input parameter as `never` lets any concrete McpTool<TSchema> satisfy this
 * shape — a function that accepts `{file_path: string}` is assignable to one
 * that accepts `never` (bivariant for function inputs). We widen to `unknown`
 * at invocation time via `inputSchema.parse()` before calling the handler.
 */
interface StoredMcpTool {
  name: string;
  serverName: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (input: never) => Promise<string>;
}

export interface SdkMcpServer {
  serverName: string;
  tools: ReadonlyArray<StoredMcpTool>;
}

// Maps "serverName:toolName" → handler
const mcpRegistry = new Map<string, StoredMcpTool>();

export function createSdkMcpServer(server: {
  serverName: string;
  tools: ReadonlyArray<StoredMcpTool>;
}): SdkMcpServer {
  for (const tool of server.tools) {
    const key = `${server.serverName}:${tool.name}`;
    mcpRegistry.set(key, tool);
  }
  return server;
}

function lookupMcpTool(toolName: string): StoredMcpTool | undefined {
  // Claude uses mcp__serverName__toolName convention
  const match = toolName.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
  if (!match) return undefined;
  const [, serverName, name] = match;
  return mcpRegistry.get(`${serverName}:${name}`);
}

// ─── Built-in tool implementations ─────────────────────────────────────────

function globSync(pattern: string, baseDir: string): string[] {
  // Matches full relative paths so directory segments in the pattern are respected.
  // e.g. "supabase/functions/**/*.ts" and "**/*.ts" behave differently.
  const results: string[] = [];

  function patternToRegex(pat: string): RegExp {
    const escaped = pat
      .replace(/\./g, '\\.')
      .replace(/\*\*\//g, '__DOUBLE_SLASH__')
      .replace(/\*\*/g, '__DOUBLE__')
      .replace(/\*/g, '[^/]*')
      .replace(/__DOUBLE_SLASH__/g, '(?:[^/]+/)*')
      .replace(/__DOUBLE__/g, '.*');
    return new RegExp(`^${escaped}$`);
  }

  const re = patternToRegex(pattern);

  function walk(dir: string, relDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, relPath);
      } else if (re.test(relPath)) {
        results.push(full);
      }
    }
  }

  walk(baseDir, '');
  return results.sort();
}

function grepSync(
  pattern: string,
  filePath: string,
): Array<{ line: number; text: string }> {
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'gm');
  } catch {
    return [];
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const matches: Array<{ line: number; text: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i] ?? '')) {
      matches.push({ line: i + 1, text: (lines[i] ?? '').trim() });
    }
    re.lastIndex = 0;
  }
  return matches;
}

// ─── Built-in tool dispatch ─────────────────────────────────────────────────

type ToolInput = Record<string, unknown>;

async function runBuiltinTool(name: string, input: ToolInput): Promise<string> {
  switch (name) {
    case 'Read': {
      const filePath = input['file_path'] as string;
      logRead(filePath);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const numbered = lines.map((l, i) => `${i + 1}\t${l}`).join('\n');
        return numbered;
      } catch (e) {
        return `Error reading file: ${String(e)}`;
      }
    }

    case 'Glob': {
      const pattern = input['pattern'] as string;
      const searchPath = (input['path'] as string | undefined) ?? process.cwd();
      const matches = globSync(pattern, searchPath);
      logGlob(pattern, matches.length);
      return matches.join('\n');
    }

    case 'Grep': {
      const pattern = input['pattern'] as string;
      const filePath = input['path'] as string | undefined;
      const glob = input['glob'] as string | undefined;

      if (filePath) {
        const matches = grepSync(pattern, filePath);
        logGrep(pattern, filePath, matches.length);
        return matches.map(m => `${filePath}:${m.line}: ${m.text}`).join('\n');
      } else if (glob) {
        // Search across files matching glob
        const baseDir = (input['path'] as string | undefined) ?? process.cwd();
        const files = globSync(glob, baseDir);
        const allMatches: string[] = [];
        for (const f of files) {
          const matches = grepSync(pattern, f);
          for (const m of matches) {
            allMatches.push(`${f}:${m.line}: ${m.text}`);
          }
        }
        return allMatches.join('\n') || '(no matches)';
      }
      return '(no path or glob specified)';
    }

    case 'Edit': {
      const filePath = input['file_path'] as string;
      const oldString = input['old_string'] as string;
      const newString = input['new_string'] as string;
      const description = (input['description'] as string | undefined) ?? 'Edit';
      logEdit(filePath, oldString, newString, description);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (!content.includes(oldString)) {
          return `Error: old_string not found in ${filePath}`;
        }
        const updated = content.replace(oldString, newString);
        fs.writeFileSync(filePath, updated, 'utf-8');
        return `Successfully edited ${filePath}`;
      } catch (e) {
        return `Error editing file: ${String(e)}`;
      }
    }

    case 'Write': {
      const filePath = input['file_path'] as string;
      const content = input['content'] as string;
      logToolCall('Write', filePath);
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf-8');
        return `Successfully wrote ${filePath}`;
      } catch (e) {
        return `Error writing file: ${String(e)}`;
      }
    }

    case 'Bash': {
      const command = input['command'] as string;
      logToolCall('Bash', command);
      try {
        const output = child_process.execSync(command, {
          encoding: 'utf-8',
          timeout: 30_000,
          cwd: process.cwd(),
        });
        return output;
      } catch (e) {
        const err = e as child_process.ExecException & { stdout?: string; stderr?: string };
        return `Exit code ${err.code ?? 1}\nstdout: ${err.stdout ?? ''}\nstderr: ${err.stderr ?? ''}`;
      }
    }

    default:
      return `Unknown built-in tool: ${name}`;
  }
}

// ─── Tool schema builders ───────────────────────────────────────────────────

function buildToolDefinitions(
  allowedTools: string[],
  servers: SdkMcpServer[],
): Anthropic.Tool[] {
  const defs: Anthropic.Tool[] = [];

  if (allowedTools.includes('Read')) {
    defs.push({
      name: 'Read',
      description: 'Read a file from the filesystem',
      input_schema: {
        type: 'object' as const,
        properties: { file_path: { type: 'string', description: 'Absolute path to file' } },
        required: ['file_path'],
      },
    });
  }

  if (allowedTools.includes('Glob')) {
    defs.push({
      name: 'Glob',
      description: 'Find files matching a glob pattern',
      input_schema: {
        type: 'object' as const,
        properties: {
          pattern: { type: 'string', description: 'Glob pattern, e.g. "**/*.ts"' },
          path: { type: 'string', description: 'Base directory to search from' },
        },
        required: ['pattern'],
      },
    });
  }

  if (allowedTools.includes('Grep')) {
    defs.push({
      name: 'Grep',
      description: 'Search for a regex pattern in files',
      input_schema: {
        type: 'object' as const,
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for' },
          path: { type: 'string', description: 'File path to search in' },
          glob: { type: 'string', description: 'Glob pattern to filter files' },
        },
        required: ['pattern'],
      },
    });
  }

  if (allowedTools.includes('Edit')) {
    defs.push({
      name: 'Edit',
      description: 'Replace a string in a file',
      input_schema: {
        type: 'object' as const,
        properties: {
          file_path: { type: 'string' },
          old_string: { type: 'string', description: 'Exact text to replace' },
          new_string: { type: 'string', description: 'Replacement text' },
          description: { type: 'string', description: 'Why this edit is being made' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    });
  }

  if (allowedTools.includes('Write')) {
    defs.push({
      name: 'Write',
      description: 'Write content to a file (overwrites)',
      input_schema: {
        type: 'object' as const,
        properties: {
          file_path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['file_path', 'content'],
      },
    });
  }

  if (allowedTools.includes('Bash')) {
    defs.push({
      name: 'Bash',
      description: 'Run a shell command',
      input_schema: {
        type: 'object' as const,
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
    });
  }

  // MCP server tools
  for (const server of servers) {
    for (const tool of server.tools) {
      const mcpName = `mcp__${server.serverName}__${tool.name}`;
      if (allowedTools.includes(mcpName) || allowedTools.includes('*')) {
        const jsonSchema = zodToJsonSchema(tool.inputSchema);
        defs.push({
          name: mcpName,
          description: tool.description,
          input_schema: jsonSchema as Anthropic.Tool['input_schema'],
        });
      }
    }
  }

  return defs;
}

type JsonSchema = Record<string, unknown>;

/**
 * Minimal Zod → JSON Schema converter for object types.
 * Handles z.object() with string, number, boolean, array, and optional fields.
 */
function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodFieldToJsonSchema(value);
      if (!(value instanceof z.ZodOptional)) {
        required.push(key);
      }
    }

    return { type: 'object', properties, required };
  }
  return { type: 'string' };
}

function zodFieldToJsonSchema(field: z.ZodTypeAny): JsonSchema {
  if (field instanceof z.ZodString) return { type: 'string', description: field.description };
  if (field instanceof z.ZodNumber) return { type: 'number', description: field.description };
  if (field instanceof z.ZodBoolean) return { type: 'boolean', description: field.description };
  if (field instanceof z.ZodOptional)
    return { ...zodFieldToJsonSchema(field.unwrap()), description: field.description };
  if (field instanceof z.ZodNullable) {
    const inner = zodFieldToJsonSchema(field.unwrap());
    return { ...inner, nullable: true, description: field.description ?? inner['description'] };
  }
  if (field instanceof z.ZodArray) {
    return {
      type: 'array',
      items: zodFieldToJsonSchema(field.element),
      description: field.description,
    };
  }
  if (field instanceof z.ZodObject) return zodToJsonSchema(field);
  return { type: 'string', description: field.description };
}

// ─── query — core agentic loop ──────────────────────────────────────────────

export interface QueryOptions {
  systemPrompt: string;
  userMessage: string;
  allowedTools: string[];
  mcpServers: SdkMcpServer[];
  model?: string;
  thinking?: { type: 'adaptive' } | { type: 'enabled'; budget_tokens: number };
  effort?: 'low' | 'medium' | 'high' | 'max';
  maxIterations?: number;
}

export interface AgentEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'done';
  text?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: string;
  finalText?: string;
}

export async function* query(options: QueryOptions): AsyncGenerator<AgentEvent> {
  const {
    systemPrompt,
    userMessage,
    allowedTools,
    mcpServers,
    model = 'claude-opus-4-6',
    thinking = { type: 'adaptive' },
    effort = 'high',
    maxIterations = 50,
  } = options;

  const client = new Anthropic();

  const tools = buildToolDefinitions(allowedTools, mcpServers);

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage },
  ];

  // The SDK type for MessageCreateParams doesn't surface output_config.effort or
  // the adaptive thinking variant yet, so we build the body against a structural
  // type that matches the runtime accepted shape.
  interface RequestBody {
    model: string;
    max_tokens: number;
    system: Array<{
      type: 'text';
      text: string;
      cache_control?: { type: 'ephemeral' };
    }>;
    thinking: QueryOptions['thinking'];
    output_config: { effort: NonNullable<QueryOptions['effort']> };
    tools: Anthropic.Tool[];
    messages: Anthropic.MessageParam[];
  }

  const baseParams: Omit<RequestBody, 'messages'> = {
    model,
    max_tokens: 16_000,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    thinking,
    output_config: { effort },
    tools,
  };

  let iterations = 0;
  let finalText = '';

  while (iterations < maxIterations) {
    iterations++;

    let response: Anthropic.Message;
    try {
      const body: RequestBody = { ...baseParams, messages };
      response = await (
        client.messages.create as (body: RequestBody) => Promise<Anthropic.Message>
      )(body);
    } catch (e) {
      // index.ts only prints `finalText` on 'done', so route the error there so
      // callers see a terminal summary even on API failure.
      const errorMessage = `API error: ${String(e)}`;
      const combined = finalText ? `${finalText}\n\n${errorMessage}` : errorMessage;
      yield { type: 'done', finalText: combined };
      return;
    }

    // Emit text blocks
    for (const block of response.content) {
      if (block.type === 'text') {
        finalText += block.text;
        yield { type: 'text', text: block.text };
      }
    }

    if (response.stop_reason === 'end_turn') {
      yield { type: 'done', finalText };
      return;
    }

    if (response.stop_reason !== 'tool_use') {
      yield { type: 'done', finalText };
      return;
    }

    // Process tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      const toolInput = block.input as ToolInput;
      yield { type: 'tool_call', toolName: block.name, toolInput };

      let result: string;

      // Check MCP registry first
      const mcpTool = lookupMcpTool(block.name);
      if (mcpTool) {
        try {
          const parsed: unknown = mcpTool.inputSchema.parse(toolInput);
          // Handler type is stored with input `never` to accept any concrete
          // schema-typed handler. Zod has already validated the payload
          // against `inputSchema`, so the cast is sound at runtime.
          result = await (mcpTool.handler as (input: unknown) => Promise<string>)(parsed);
        } catch (e) {
          result = `Tool error: ${String(e)}`;
        }
      } else {
        // Built-in tool
        result = await runBuiltinTool(block.name, toolInput);
      }

      yield { type: 'tool_result', toolName: block.name, toolResult: result };

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result,
      });
    }

    // Append assistant turn + tool results
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
  }

  yield { type: 'done', finalText };
}
