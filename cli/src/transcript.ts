/**
 * Read what your coding assistant wrote down and then forgot to tell you about.
 *
 * Every assistant that can resume a conversation must store the conversation. That store is
 * the only record of WHY your code is the way it is — and Claude Code deletes it after 30 days.
 *
 * This module turns that store into an index of EDITS: every time the assistant wrote to a
 * file, with the words you said just before, and the words it said while doing it.
 *
 * Nothing here is generated. Everything here is quoted.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';

/** One thing the assistant wrote to disk, and the conversation around it. */
export interface Edit {
  /** absolute path the assistant claimed to write */
  file: string;
  /** ISO date (YYYY-MM-DD) */
  date: string;
  /** full ISO timestamp — used to break ties and to cross-check `git blame` */
  ts: string;
  /** the exact text written. THIS is what we match against. Never generated. */
  body: string;
  /** what you said, in your own words, in the turn that led here */
  prompt: string;
  /** what the assistant said it was doing, in its own words, at that moment */
  said: string;
  /** which session file this came from — the receipt */
  session: string;
}

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** Machine-injected prompts that aren't the human speaking. */
export function isRealPrompt(s: string): boolean {
  if (!s) return false;
  if (s.startsWith('<') || s.startsWith('[Request') || s.startsWith('Caveat:')) return false;
  if (s.includes('task-notification')) return false;
  if (s.includes('This session is being continued')) return false;
  return true;
}

export function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b): b is { type: string; text?: string } => typeof b === 'object' && b !== null)
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join(' ');
}

export function hasToolResult(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some((b) => typeof b === 'object' && b !== null && (b as { type?: string }).type === 'tool_result')
  );
}

/** Parse one Claude Code session transcript into its edits. */
export function parseSession(path: string): Edit[] {
  const edits: Edit[] = [];
  const session = basename(path, '.jsonl');
  let prompt = '';
  let said = '';

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue; // a truncated final line is normal; skip it
    }
    if (d.isSidechain || d.isMeta) continue; // subagents aren't your conversation

    const content = d.message?.content;

    if (d.type === 'user') {
      if (hasToolResult(content)) continue; // tool output, not the human
      const s = textOf(content).trim();
      if (isRealPrompt(s)) {
        prompt = s;
        said = '';
      }
      continue;
    }

    if (d.type !== 'assistant' || !Array.isArray(content)) continue;
    const ts: string = d.timestamp ?? '';

    for (const b of content) {
      if (typeof b !== 'object' || b === null) continue;
      if (b.type === 'text' && b.text?.trim()) said = b.text;
      if (b.type === 'tool_use' && WRITE_TOOLS.has(b.name)) {
        const file: string = b.input?.file_path ?? '';
        if (!file) continue;
        for (const body of bodiesOf(b.input)) {
          edits.push({ file, date: ts.slice(0, 10), ts, body, prompt, said, session });
        }
      }
    }
  }
  return edits;
}

/**
 * Every chunk of text a write-tool put on disk.
 *
 * The three tools disagree on shape and the difference is NOT cosmetic:
 *   Edit       -> { new_string }
 *   Write      -> { content }
 *   MultiEdit  -> { edits: [{ old_string, new_string }, ...] }   ← several writes, one call
 *
 * Reading only `new_string ?? content` drops every MultiEdit silently — and a dropped edit
 * doesn't produce an error, it produces a LIE: `why` finds no match and confidently reports
 * "you wrote this line." Sun's archive happens to contain zero MultiEdits, so this was
 * invisible here and would have fired on the first stranger's machine.
 */
function bodiesOf(input: unknown): string[] {
  const i = input as { new_string?: string; content?: string; edits?: { new_string?: string }[] };
  if (Array.isArray(i?.edits)) {
    return i.edits.map((e) => e?.new_string ?? '').filter((s) => s.length > 0);
  }
  const single = i?.new_string ?? i?.content ?? '';
  return single ? [single] : [];
}

/** Claude Code encodes a project path as its slug: /home/you/proj -> -home-you-proj */
export function projectSlug(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

export function claudeProjectDir(cwd: string): string {
  return join(homedir(), '.claude', 'projects', projectSlug(cwd));
}

/** Every edit the assistant ever made in this project, oldest first. */
export function loadEdits(cwd: string): Edit[] {
  const dir = claudeProjectDir(cwd);
  if (!existsSync(dir)) return [];
  const edits = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) => parseSession(join(dir, f)));
  edits.sort((a, b) => a.ts.localeCompare(b.ts));
  return edits;
}
