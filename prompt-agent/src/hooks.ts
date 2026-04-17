/**
 * Hooks that log file reads and edits to stdout with timestamps.
 * In apply mode, edits are logged with before/after context.
 */

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 23);
}

export function logRead(filePath: string): void {
  console.log(`[${timestamp()}] READ  ${filePath}`);
}

export function logGlob(pattern: string, matchCount: number): void {
  console.log(`[${timestamp()}] GLOB  ${pattern}  →  ${matchCount} match${matchCount === 1 ? '' : 'es'}`);
}

export function logGrep(pattern: string, filePath: string, matchCount: number): void {
  console.log(`[${timestamp()}] GREP  "${pattern}" in ${filePath}  →  ${matchCount} match${matchCount === 1 ? '' : 'es'}`);
}

export function logEdit(filePath: string, before: string, after: string, description: string): void {
  console.log(`\n[${timestamp()}] EDIT  ${filePath}`);
  console.log(`  REASON: ${description}`);
  console.log(`  BEFORE:\n${before.split('\n').map(l => `    ${l}`).join('\n')}`);
  console.log(`  AFTER:\n${after.split('\n').map(l => `    ${l}`).join('\n')}`);
}

export function logToolCall(toolName: string, summary: string): void {
  console.log(`[${timestamp()}] TOOL  ${toolName}: ${summary}`);
}

export function logAgentText(text: string): void {
  process.stdout.write(text);
}

export function logSection(title: string): void {
  const line = '─'.repeat(60);
  console.log(`\n${line}\n  ${title}\n${line}`);
}
