/**
 * THE ARTIFACT — one HUMAN.<record>.md per HUMAN+AI pair.
 *
 * This is the waist's last step and it belongs to nobody's tool. Writing the profile and DELIVERING
 * it are two jobs that lived in one file until a second assistant made the difference matter: a
 * profile has to exist before anything can carry it, and each pair needs its own file so one tool
 * can never receive claims measured inside another relationship.
 *
 * So: this module owns the file. The `load-*` modules own getting each assistant to read it, and
 * they differ more than you would expect — Claude Code follows a one-line import, Codex has no
 * import syntax at all and needs the text copied in, and an MCP client asks for it over a pipe.
 * None of that belongs here.
 *
 * WHY IT LIVES IN ~/.stratless (moved 2026-07-31). The profile is the PERSON'S, not a tool's.
 * Keeping it inside Claude Code's directory meant uninstalling that tool took the profile with it,
 * and an assistant we never read would have been served its user's profile out of a competitor's
 * folder. The sharper reason is privacy: people keep `~/.claude` in dotfiles repos, and a
 * behavioural read of how someone works is the last file that should ride along in a `git add -A`.
 */
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteFileSync } from './atomic.js';

/**
 * ONE PAIR'S PROFILE — `HUMAN.<record>.md`, one file per HUMAN+AI relationship.
 *
 * There is no "the" profile any more (the per-record doctrine, 2026-08-03): what was measured with
 * one assistant describes that relationship and no other, so each assistant reads the file its own
 * history earned. The directory is shared; the record id in the name is what keeps a Codex tool
 * from ever being handed claims measured in Claude Code.
 */
export function profilePath(record: string): string {
  return join(process.env.STRATLESS_PROFILE_DIR || join(homedir(), '.stratless'), `HUMAN.${record}.md`);
}

/** The merged-era artifact — one file, every assistant. Never WRITTEN any more; still read during
 *  the interim between an upgrade and the first consented per-record rebuild (the old profile keeps
 *  serving rather than vanishing), and named to the person by `stop` as their data to keep.
 *  Override with STRATLESS_HUMAN_MD. */
export function humanMdPath(): string {
  return process.env.STRATLESS_HUMAN_MD || join(homedir(), '.stratless', 'HUMAN.md');
}


/** The installed version, read from the package.json that ships next to dist/ — stamped into the
 *  managed header so the file itself says which stratless wrote it. Never hand-typed. */
export function installedVersion(): string {
  try {
    // Compiles to dist/storage/profile.js, while package.json stays at the package root.
    const pkg = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    return (JSON.parse(readFileSync(pkg, 'utf8')).version as string) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Write the profile, header and all, and return where it landed.
 *
 * The `# built` line is the version stamp: someone opening the file can tell at a glance whether
 * they are reading the latest rebuild. UTC, minute precision — globalized and unambiguous anywhere.
 */
export function writeProfile(text: string, target: string = humanMdPath(), builtAt: string = new Date().toISOString()): string {
  const stamp = `${builtAt.slice(0, 16).replace('T', ' ')} UTC`; // 2026-07-23T12:28:56.777Z -> "2026-07-23 12:28 UTC"
  const body = [
    '# Who you are working with',
    `# (managed by stratless ${installedVersion()}: do not edit by hand; refreshed by \`stratless update\`)`,
    `# built ${stamp}`,
    '<!-- format: humanmd/v3 -->', // the person-layer format marker
    '',
    text.trim(),
    '',
  ].join('\n');
  atomicWriteFileSync(target, body);
  return target;
}

/** The profile as it stands, or undefined when none has been built. */
export function readProfile(target: string = humanMdPath()): string | undefined {
  try {
    return readFileSync(target, 'utf8');
  } catch {
    return undefined;
  }
}

