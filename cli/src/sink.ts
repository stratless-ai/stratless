/**
 * THE LOAD — put the profile where the assistant will read it.
 *
 * Claude Code auto-loads ~/.claude/CLAUDE.md into its context at the start of every session, so the
 * profile goes there — inside a delimited **managed block**. We only ever touch what's between our
 * markers; anything the person wrote themselves is left exactly as it was.
 *
 * `HUMAN.md` is the convention (build-pass §9); for Claude Code specifically the mechanism is a
 * CLAUDE.md block, because that is the file Claude Code actually reads. The privacy rule holds: this
 * file is visible to your assistant, never networked, never committed by us.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** The global file Claude Code loads every session. Override with STRATLESS_CLAUDE_MD (tests). */
export function claudeMdPath(): string {
  return process.env.STRATLESS_CLAUDE_MD || join(homedir(), '.claude', 'CLAUDE.md');
}

const START = '<!-- stratless:start -->';
const END = '<!-- stratless:end -->';

/**
 * Write the profile into the assistant's global instructions file as a managed block. Returns the
 * path written. Idempotent: re-running replaces our block in place and never disturbs the rest.
 */
export function injectProfile(text: string, target = claudeMdPath()): string {
  const block = [
    START,
    '# Who you are working with',
    '# (managed by stratless — do not edit by hand; refreshed by `stratless update`)',
    '',
    text.trim(),
    END,
  ].join('\n');

  let doc = existsSync(target) ? readFileSync(target, 'utf8') : '';
  const s = doc.indexOf(START);
  const e = doc.indexOf(END);
  if (s !== -1 && e !== -1 && e > s) {
    // Replace our block in place — everything around it is the person's, leave it untouched.
    doc = doc.slice(0, s) + block + doc.slice(e + END.length);
  } else {
    // No block yet: append after their content (blank line between), or start the file.
    doc = doc.trim() ? `${doc.trimEnd()}\n\n${block}\n` : `${block}\n`;
  }

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, doc);
  return target;
}
