/**
 * THE LOAD — put the profile where the assistant will read it.
 *
 * The canonical artifact is HUMAN.md — one file that describes the person, the thing every tool loads
 * to know who it's talking to. Claude Code can't be pointed at an arbitrary filename, but it DOES
 * expand `@import` lines inside the CLAUDE.md it already auto-loads. So the load is two writes:
 *
 *   1. write the profile to ~/.claude/HUMAN.md         — the canonical artifact
 *   2. put a one-line `@~/.claude/HUMAN.md` redirect    — inside a managed block in CLAUDE.md
 *
 * CLAUDE.md becomes a pointer, not a copy. Other tools (Gemini, Codex) point their own configurable
 * filename at the same HUMAN.md — one source, many entry points (build-pass §9, the adapter seam).
 *
 * We only ever touch what's between our markers in CLAUDE.md; anything the person wrote themselves is
 * left exactly as it was. HUMAN.md is written FIRST, so the import never points at a missing file. The
 * privacy rule holds: these files are visible to your assistant, never networked, never committed by us.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';

/** The global file Claude Code loads every session. Override with STRATLESS_CLAUDE_MD (tests). */
export function claudeMdPath(): string {
  return process.env.STRATLESS_CLAUDE_MD || join(homedir(), '.claude', 'CLAUDE.md');
}

/** The canonical profile artifact — the file every tool ultimately reads. Override with STRATLESS_HUMAN_MD. */
export function humanMdPath(): string {
  return process.env.STRATLESS_HUMAN_MD || join(homedir(), '.claude', 'HUMAN.md');
}

const START = '<!-- stratless:start -->';
const END = '<!-- stratless:end -->';

/** The `@import` line Claude Code expands — home-relative when possible (portable), else absolute. */
function importLine(humanPath: string): string {
  const home = homedir();
  if (humanPath === home || humanPath.startsWith(home + sep)) {
    return `@~${humanPath.slice(home.length).split(sep).join('/')}`;
  }
  return `@${humanPath}`;
}

export interface Injected {
  /** the canonical artifact we wrote the profile to */
  humanMd: string;
  /** the file we pointed at it */
  claudeMd: string;
}

/**
 * Write the profile to HUMAN.md and point CLAUDE.md at it. Returns both paths. Idempotent: re-running
 * rewrites HUMAN.md and replaces our CLAUDE.md block in place, never disturbing the rest.
 */
export function injectProfile(
  text: string,
  humanTarget: string = humanMdPath(),
  claudeTarget: string = claudeMdPath(),
): Injected {
  // 1. The canonical artifact — written FIRST, so the redirect never points at a missing file.
  const human = [
    '# Who you are working with',
    '# (managed by stratless — do not edit by hand; refreshed by `stratless update`)',
    '<!-- humanmd/v1 -->', // the person-layer protocol's schema marker (0.3.1: sectioned form)
    '',
    text.trim(),
    '',
  ].join('\n');
  mkdirSync(dirname(humanTarget), { recursive: true });
  writeFileSync(humanTarget, human);

  // 2. Point CLAUDE.md at it, inside our managed block — the person's own content is never touched.
  upsertBlock(humanTarget, claudeTarget);

  return { humanMd: humanTarget, claudeMd: claudeTarget };
}

/** Upsert our managed block in CLAUDE.md so it @imports HUMAN.md. Only ever touches what's between
 *  the markers; everything around it is the person's and is left exactly as it was. */
function upsertBlock(humanTarget: string, claudeTarget: string): void {
  const block = [
    START,
    '# Who you are working with — managed by stratless. Edit HUMAN.md, not here.',
    importLine(humanTarget),
    END,
  ].join('\n');

  let doc = existsSync(claudeTarget) ? readFileSync(claudeTarget, 'utf8') : '';
  const s = doc.indexOf(START);
  const e = doc.indexOf(END);
  if (s !== -1 && e !== -1 && e > s) {
    // Replace our block in place — everything around it is the person's, leave it untouched.
    doc = doc.slice(0, s) + block + doc.slice(e + END.length);
  } else {
    // No block yet: append after their content (blank line between), or start the file.
    doc = doc.trim() ? `${doc.trimEnd()}\n\n${block}\n` : `${block}\n`;
  }
  mkdirSync(dirname(claudeTarget), { recursive: true });
  writeFileSync(claudeTarget, doc);
}

/**
 * The cheap half of the load: point CLAUDE.md at an EXISTING HUMAN.md without rewriting the profile.
 * A gated `update` (no synthesis due) uses this to guarantee the profile stays loaded — e.g. after a
 * `stop` — without spending a fresh build. Returns true iff a HUMAN.md existed to point at.
 */
export function ensureLoaded(humanTarget: string = humanMdPath(), claudeTarget: string = claudeMdPath()): boolean {
  if (!existsSync(humanTarget)) return false;
  upsertBlock(humanTarget, claudeTarget);
  return true;
}

/**
 * Unload the profile: strip our managed block from CLAUDE.md so the assistant stops loading it. Leaves
 * HUMAN.md exactly where it is — it just stops being imported; the person's own data is theirs to keep
 * or delete. Only ever touches what's between our markers; surrounding content is preserved and the
 * whitespace closes up cleanly. Returns true iff a block was actually removed (safe no-op otherwise,
 * including when the file doesn't exist).
 */
export function removeProfile(claudeTarget: string = claudeMdPath()): boolean {
  if (!existsSync(claudeTarget)) return false;
  const doc = readFileSync(claudeTarget, 'utf8');
  const s = doc.indexOf(START);
  const e = doc.indexOf(END);
  if (s === -1 || e === -1 || e < s) return false;

  const before = doc.slice(0, s).replace(/\s+$/, '');
  const after = doc.slice(e + END.length).replace(/^\s+/, '').replace(/\s+$/, '');
  const parts = [before, after].filter(Boolean);
  writeFileSync(claudeTarget, parts.length ? `${parts.join('\n\n')}\n` : '');
  return true;
}
