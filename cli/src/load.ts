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
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteFileSync } from './atomic.js';

/** The global file Claude Code loads every session. Override with STRATLESS_CLAUDE_MD (tests). */
export function claudeMdPath(): string {
  return process.env.STRATLESS_CLAUDE_MD || join(homedir(), '.claude', 'CLAUDE.md');
}

/** The canonical profile artifact — the file every tool ultimately reads. Override with STRATLESS_HUMAN_MD. */
export function humanMdPath(): string {
  return process.env.STRATLESS_HUMAN_MD || join(homedir(), '.stratless', 'HUMAN.md');
}

/** Where the profile lived before it became one artifact many assistants point at. */
function legacyHumanMdPath(): string {
  return join(homedir(), '.claude', 'HUMAN.md');
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
/** The installed version, read from the package.json that ships next to dist/ — stamped into the
 *  managed header so the file itself says which stratless wrote it. Never hand-typed. */
export function installedVersion(): string {
  try {
    const pkg = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return (JSON.parse(readFileSync(pkg, 'utf8')).version as string) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function injectProfile(
  text: string,
  humanTarget: string = humanMdPath(),
  claudeTarget: string = claudeMdPath(),
  builtAt: string = new Date().toISOString(),
): Injected {
  // 1. The canonical artifact — written FIRST, so the redirect never points at a missing file.
  // The `# built` line is the version stamp: a person opening HUMAN.md can tell at a glance whether
  // they are reading the latest rebuild. UTC (globalized, unambiguous anywhere), minute precision.
  const stamp = `${builtAt.slice(0, 16).replace('T', ' ')} UTC`; // 2026-07-23T12:28:56.777Z -> "2026-07-23 12:28 UTC"
  const human = [
    '# Who you are working with',
    `# (managed by stratless ${installedVersion()}: do not edit by hand; refreshed by \`stratless update\`)`,
    `# built ${stamp}`,
    '<!-- format: humanmd/v3 -->', // the person-layer format marker (v3: the conductor's brief + the LIFT rows)
    '',
    text.trim(),
    '',
  ].join('\n');
  atomicWriteFileSync(humanTarget, human);

  // 2. Point CLAUDE.md at it, inside our managed block — the person's own content is never touched.
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
 * Move a pre-0.7.2 profile out of Claude Code's directory into stratless's own, ONCE, and re-point the
 * import that was aimed at it. Silent and idempotent: every later run finds the new file already there
 * and does nothing.
 *
 * Three refusals, each protecting something the person owns:
 *  · a redirected profile (STRATLESS_HUMAN_MD) is a deliberate choice — a test's or a person's — and is
 *    never migrated out from under them;
 *  · a file whose first line is not the header WE stamp is not ours to move, however much it looks like
 *    a profile. We only ever delete a file we can prove we wrote;
 *  · the import block is rewritten only if one is ALREADY there. Adding it here would silently re-load
 *    a profile the person turned off with `stratless stop`, which is the one thing that switch promises.
 */
export function migrateLegacyProfile(
  target: string = humanMdPath(),
  legacy: string = legacyHumanMdPath(),
  claudeTarget: string = claudeMdPath(),
): boolean {
  // Guards the env var itself, not the argument: a test that redirects the profile into a temp dir
  // must never reach past it and move the developer's REAL one.
  if (process.env.STRATLESS_HUMAN_MD) return false;
  if (existsSync(target) || !existsSync(legacy)) return false;

  let body: string;
  try {
    body = readFileSync(legacy, 'utf8');
  } catch {
    return false; // unreadable is not ours to move
  }
  if (!body.startsWith('# Who you are working with')) return false;

  atomicWriteFileSync(target, body);
  try {
    unlinkSync(legacy);
  } catch {
    /* the copy is what matters; a leftover costs nothing but tidiness */
  }
  // Re-aim an existing import at the file's new home — the old line now points at nothing.
  if (existsSync(claudeTarget) && readFileSync(claudeTarget, 'utf8').includes(START)) upsertBlock(target, claudeTarget);
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
