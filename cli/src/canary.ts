/**
 * THE CANARY — the alarm for the failure that would end this product.
 *
 * stratless reads a log format it does not own. Claude Code will change that format — not if,
 * when. And when it does, nothing crashes. We parse zero edits, match nothing, and tell every
 * user "you wrote this line yourself" with total confidence, forever, silently.
 *
 * That is a LIE AT SCALE, and it is the one failure mode nobody would notice for weeks.
 *
 * So: if there are transcripts on disk but we got nothing out of them, do not shrug. SAY SO.
 * A tool that refuses is trustworthy. A tool that quietly starts lying is finished.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { claudeProjectDir, type Edit } from './transcript.js';

export interface Health {
  ok: boolean;
  /** transcript files found on disk */
  files: number;
  /** total bytes of transcript */
  bytes: number;
  /** edits we managed to parse out of them */
  edits: number;
  /** tool names seen in the raw JSONL that we did NOT parse — the tell that the format moved */
  unknownWriteTools: string[];
  reason?: string;
}

/** Tool names that write to disk. Anything else that looks like a write is news to us. */
const KNOWN = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const LOOKS_LIKE_A_WRITE = /edit|write|patch|apply|create.?file|replace/i;

export function health(cwd: string, edits: Edit[]): Health {
  const dir = claudeProjectDir(cwd);
  if (!existsSync(dir)) {
    return { ok: true, files: 0, bytes: 0, edits: 0, unknownWriteTools: [] };
  }

  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  const bytes = files.reduce((n, f) => n + statSync(join(dir, f)).size, 0);

  // Sniff the RAW jsonl. Two different things we need to know apart:
  //   knownWrites   — the log contains a write tool we recognise (Edit/Write/…)
  //   unknown       — the log contains a write-SHAPED tool name we've never seen
  const unknown = new Set<string>();
  let knownWrites = 0;
  for (const f of files.slice(-5)) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!line.includes('"tool_use"')) continue;
      const m = /"name"\s*:\s*"([^"]+)"/g;
      let hit: RegExpExecArray | null;
      while ((hit = m.exec(line))) {
        const name = hit[1];
        if (KNOWN.has(name)) knownWrites++;
        else if (LOOKS_LIKE_A_WRITE.test(name)) unknown.add(name);
      }
    }
  }

  // ZERO EDITS IS NOT AN ALARM ON ITS OWN. A project where the assistant only ever talked —
  // planning, answering, `claude -p` calls — legitimately has no edits. The canary fired
  // falsely on exactly that case during development, which is why it exists.
  //
  // The real signal is narrower and unambiguous: WE CAN SEE THE WRITE TOOL IN THE LOG, BUT
  // WE CANNOT READ ITS INPUT. That means the schema moved under us, and every answer we give
  // from here would be "you wrote this yourself" — a lie, at scale, silently.
  if (knownWrites > 0 && edits.length === 0) {
    return {
      ok: false,
      files: files.length,
      bytes,
      edits: 0,
      unknownWriteTools: [...unknown],
      reason:
        `Found ${knownWrites} write-tool calls across ${files.length} transcripts, but could not read a ` +
        `single edit out of them. The log format has changed.\n\n` +
        `  stratless will NOT guess. Every answer would be "you wrote this yourself" — and that would be a lie.\n\n` +
        `  Please open an issue. It needs no code from you:\n` +
        `  https://github.com/stratless-ai/stratless/issues/new?title=format+drift`,
    };
  }

  if (unknown.size) {
    return {
      ok: false,
      files: files.length,
      bytes,
      edits: edits.length,
      unknownWriteTools: [...unknown],
      reason:
        `Your assistant used write tools stratless doesn't know: ${[...unknown].join(', ')}.\n` +
        `  Edits made with them are INVISIBLE here — lines they wrote will be reported as yours.\n` +
        `  https://github.com/stratless-ai/stratless/issues/new?title=unknown+tool+${[...unknown][0]}`,
    };
  }

  return { ok: true, files: files.length, bytes, edits: edits.length, unknownWriteTools: [] };
}
