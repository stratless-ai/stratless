/**
 * PUT THE PROFILE WHERE CODEX WILL READ IT.
 *
 * Codex loads `AGENTS.md` at the start of every session, the way Claude Code loads `CLAUDE.md`. But
 * it has NO import syntax — there is no `@file` line it will expand — so the profile cannot be
 * pointed at. It has to be COPIED IN, between our markers, and rewritten whenever it changes.
 *
 * SUNSET (2026-08-10): the profile is internal evidence now — the sitting reads it, nobody
 * imports it. This leg's load() is no longer called; unload() is the half that still runs, taking
 * our markers OUT of older installs, and it stays until every machine has crossed.
 *
 * THE SHADOW RULE, and it is the one thing that silently breaks this. Codex checks
 * `AGENTS.override.md` FIRST and, if it finds one, reads that INSTEAD — not as well. So writing a
 * perfect block into `AGENTS.md` when an override exists produces a file nobody reads, with no
 * error anywhere. The live file is whichever one Codex would actually load, and that is the one we
 * write to.
 *
 * A COPY, NOT A POINTER, has a consequence worth stating: this file goes stale between builds in a
 * way Claude's never does. Every rebuild must rewrite it, which is why the loader is called on the
 * same path that writes the artifact rather than only at install.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFileSync } from '../../../storage/atomic.js';
import { profilePath, readProfile } from '../../../storage/profile.js';
import { RECORD_ID } from './record.js';
import { codexHome } from './paths.js';

// All three Codex legs resolve the tool's directory through paths.ts.

/**
 * THE FILE CODEX WOULD ACTUALLY LOAD.
 *
 * An override, when present, wins outright — so it is the only honest target. When neither exists
 * we create the ordinary one, because a person with no instructions file yet has expressed no
 * preference about which to use.
 */
export function agentsMdPath(): string {
  const home = codexHome();
  const override = join(home, 'AGENTS.override.md');
  return existsSync(override) ? override : join(home, 'AGENTS.md');
}

const START = '<!-- stratless:start -->';
const END = '<!-- stratless:end -->';

/**
 * Write the profile into Codex's instructions, inside our managed block.
 *
 * Everything outside the markers is the person's and is never touched. Returns the file written,
 * or undefined when there is no profile yet to deliver — silence rather than an empty block, so
 * the person's own file is not marked up with nothing.
 */
export function loadInto(target: string = agentsMdPath()): string | undefined {
  // ITS OWN PAIR'S FILE, never "the" profile: this copy lands inside Codex, so it may carry only
  // what was measured working WITH Codex (the per-record doctrine). No file yet — a pair still
  // below its evidence floor — means nothing is written, and the person's AGENTS.md stays theirs.
  const profile = readProfile(profilePath(RECORD_ID));
  if (!profile) return undefined;

  // No header of our own: unlike Claude Code's block — which holds a bare import line and needs one —
  // the profile being copied here already opens with its own "managed by stratless, do not edit"
  // stamp. Adding a second would print the same title twice at the top of the person's file.
  const block = [START, profile.trim(), END].join('\n');

  let doc = existsSync(target) ? readFileSync(target, 'utf8') : '';
  const s = doc.indexOf(START);
  const e = doc.indexOf(END);
  if (s !== -1 && e !== -1 && e > s) {
    doc = doc.slice(0, s) + block + doc.slice(e + END.length);
  } else {
    doc = doc.trim() ? `${doc.trimEnd()}\n\n${block}\n` : `${block}\n`;
  }
  atomicWriteFileSync(target, doc);
  return target;
}

/** Is our block in the file Codex would load? */
export function loaded(target: string = agentsMdPath()): boolean {
  try {
    return readFileSync(target, 'utf8').includes(START);
  } catch {
    return false;
  }
}

/**
 * Take the profile back out. The person's own instructions close up cleanly around the gap; only
 * what is between our markers is removed. Returns whether a block was actually there.
 */
export function unload(target: string = agentsMdPath()): boolean {
  if (!existsSync(target)) return false;
  const doc = readFileSync(target, 'utf8');
  const s = doc.indexOf(START);
  const e = doc.indexOf(END);
  if (s === -1 || e === -1 || e < s) return false;

  const before = doc.slice(0, s).replace(/\s+$/, '');
  const after = doc.slice(e + END.length).replace(/^\s+/, '').replace(/\s+$/, '');
  const parts = [before, after].filter(Boolean);
  atomicWriteFileSync(target, parts.length ? `${parts.join('\n\n')}\n` : '');
  return true;
}
