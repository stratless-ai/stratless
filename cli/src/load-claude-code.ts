/**
 * THE LOAD — put the profile where the assistant will read it.
 *
 * The canonical artifact is HUMAN.md — one file that describes the person, the thing every tool loads
 * to know who it's talking to. Claude Code can't be pointed at an arbitrary filename, but it DOES
 * expand `@import` lines inside the CLAUDE.md it already auto-loads. So the load is two writes:
 *
 *   1. write the profile to ~/.stratless/HUMAN.md       — the canonical artifact
 *   2. put a one-line `@~/.stratless/HUMAN.md` redirect  — inside a managed block in CLAUDE.md
 *
 * CLAUDE.md becomes a pointer, not a copy — and every other route to the same file is a variation on
 * that one theme: a tool that takes a path reads it directly (aider's `read:`), a tool with no import
 * syntax gets the text copied into the block instead of a line pointing at it (codex's AGENTS.md),
 * and `stratless mcp` serves it to anything that asks. One artifact, many entry points.
 *
 * WHY IT LIVES IN ~/.stratless AND NOT ~/.claude (moved 2026-07-31). The profile is the PERSON'S, not
 * a tool's: keeping it inside Claude Code's directory meant uninstalling that tool took the profile
 * with it, and an assistant we never read would be served its user's profile out of a competitor's
 * folder. The sharper reason is privacy — people keep ~/.claude in dotfiles repos (atomic.ts follows
 * symlinks precisely because one such link got severed), and a behavioural profile is the last file
 * that should ride along in a `git add -A`. ~/.stratless is ours, holds every other output already,
 * and nobody syncs it. `migrateLegacyProfile` moves an older install across, once.
 *
 * We only ever touch what's between our markers in CLAUDE.md; anything the person wrote themselves is
 * left exactly as it was. HUMAN.md is written FIRST, so the import never points at a missing file. The
 * privacy rule holds: these files are visible to your assistant, never networked, never committed by us.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { atomicWriteFileSync } from './atomic.js';
import { humanMdPath } from './profile.js';

/** The global file Claude Code loads every session. Override with STRATLESS_CLAUDE_MD (tests). */
export function claudeMdPath(): string {
  return process.env.STRATLESS_CLAUDE_MD || join(homedir(), '.claude', 'CLAUDE.md');
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
 * POINT CLAUDE CODE AT THE PROFILE.
 *
 * Claude Code cannot be told to load an arbitrary filename, but it DOES expand `@import` lines
 * inside the `CLAUDE.md` it already reads every session. So the delivery is one line in a managed
 * block: CLAUDE.md becomes a pointer, never a copy, and a rebuilt profile is picked up without
 * touching this file again.
 *
 * Only ever touches what is between our markers; anything the person wrote themselves is left
 * exactly as it was.
 */
export function loadInto(humanTarget: string = humanMdPath(), claudeTarget: string = claudeMdPath()): Injected {
  upsertBlock(humanTarget, claudeTarget);
  return { humanMd: humanTarget, claudeMd: claudeTarget };
}

/** Upsert our managed block in CLAUDE.md so it @imports HUMAN.md. Only ever touches what's between
 *  the markers; everything around it is the person's and is left exactly as it was. */
function upsertBlock(humanTarget: string, claudeTarget: string): void {
  const block = [
    START,
    '# Who you are working with. Managed by stratless; edit HUMAN.md, not here.',
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
  atomicWriteFileSync(claudeTarget, doc);
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
 * RE-AIM AN EXISTING POINTER, and only an existing one.
 *
 * For when the artifact moves under a person who already had it loaded. The distinction from
 * `ensureLoaded` is the whole point: this NEVER adds a block that is not there, because someone who
 * ran `stratless stop` turned the profile off deliberately, and a housekeeping move must not undo
 * a decision they made.
 */
export function reaimIfLoaded(humanTarget: string = humanMdPath(), claudeTarget: string = claudeMdPath()): boolean {
  if (!existsSync(claudeTarget) || !readFileSync(claudeTarget, 'utf8').includes(START)) return false;
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
  atomicWriteFileSync(claudeTarget, parts.length ? `${parts.join('\n\n')}\n` : '');
  return true;
}
