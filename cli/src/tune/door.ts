/**
 * THE DOOR'S PLAN — what an install would do, computed before anything is asked (Solo V2,
 * step 6). The door's whole contract is that the prescription can be shown, diffed, and
 * refused without a byte landing anywhere: so this module PLANS — pure data in, pure data
 * out — and the command shell owns the two impurities (the question and the writes).
 *
 * Re-running the door is the refresh: the plan diffs each artifact against what's on disk,
 * so the same machinery prints "new" on first install and "updated / unchanged" afterwards.
 * Units the inspection found covered by the person's OWN skills are skipped with the cover
 * named — installing would duplicate a thing they chose; the prescription validates their
 * pick instead.
 */
import type { CompiledArtifact } from './compile.js';
import type { CoverVerdict } from './inspect.js';

export interface InstallTarget {
  /** where skill directories land (Claude Code: ~/.claude/skills) */
  skillsDir: string;
  /** where ambient block files land (ours: ~/.stratless/tune/<record>) */
  blocksDir: string;
}

export type EntryStatus = 'new' | 'updated' | 'unchanged' | 'covered';

export interface PlanEntry {
  artifact: CompiledArtifact;
  status: EntryStatus;
  /** absolute path the artifact lands at (absent when covered) */
  path?: string;
  /** who covers it, when covered */
  coveredBy?: string;
}

export interface InstallPlan {
  entries: PlanEntry[];
  /** the writes a yes performs, in order */
  writes: { path: string; content: string }[];
  /** block files, for the always-loaded import section the shell maintains */
  blockPaths: string[];
  counts: { skills: number; styles: number; newOrUpdated: number; covered: number };
}

/** Print order: the doing-habits first (patched leading inside compile order), then the
 *  format-habits, then the tone-habits — the workflow reads top-down as work does. */
const KIND_ORDER: Record<CompiledArtifact['kind'], number> = { active: 0, triggered: 1, ambient: 2 };

export function planInstall(
  artifacts: CompiledArtifact[],
  verdicts: CoverVerdict[],
  target: InstallTarget,
  /** current on-disk content per planned path — the shell reads, the plan only compares */
  existing: Map<string, string>,
): InstallPlan {
  const verdictOf = new Map(verdicts.map((v) => [v.name, v]));
  const sorted = [...artifacts].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name),
  );

  const entries: PlanEntry[] = sorted.map((artifact) => {
    const v = verdictOf.get(artifact.name);
    if (v && v.verdict === 'already-fitted') {
      return { artifact, status: 'covered', ...(v.coveredBy ? { coveredBy: v.coveredBy } : {}) };
    }
    const root = artifact.kind === 'ambient' ? target.blocksDir : target.skillsDir;
    const path = `${root}/${artifact.filename}`;
    const current = existing.get(path);
    const status: EntryStatus = current === undefined ? 'new' : current === artifact.content ? 'unchanged' : 'updated';
    return { artifact, status, path };
  });

  const writes = entries
    .filter((e) => e.status === 'new' || e.status === 'updated')
    .map((e) => ({ path: e.path!, content: e.artifact.content }));
  const blockPaths = entries.filter((e) => e.artifact.kind === 'ambient' && e.path).map((e) => e.path!);

  return {
    entries,
    writes,
    blockPaths,
    counts: {
      skills: entries.filter((e) => e.artifact.kind !== 'ambient' && e.status !== 'covered').length,
      styles: entries.filter((e) => e.artifact.kind === 'ambient' && e.status !== 'covered').length,
      newOrUpdated: writes.length,
      covered: entries.filter((e) => e.status === 'covered').length,
    },
  };
}

/** The always-loaded import section the shell upserts into CLAUDE.md — OUR OWN markers,
 *  separate from the profile's block, so neither writer ever clobbers the other and `stop`
 *  can remove each cleanly. */
export const TUNE_START = '<!-- stratless-tune:start -->';
export const TUNE_END = '<!-- stratless-tune:end -->';

export function tuneSection(blockPaths: string[], home: string): string {
  const importLine = (p: string): string => (p.startsWith(home) ? `@~${p.slice(home.length)}` : `@${p}`);
  return [
    TUNE_START,
    '# The tune — always-on style, minted by stratless from this pair. `stratless stop` removes it.',
    ...blockPaths.map(importLine),
    TUNE_END,
  ].join('\n');
}

/** Upsert our tune section; everything around it is the person's and is left exactly as it
 *  was (the load.ts discipline, applied to our second surface). Empty blockPaths REMOVES the
 *  section — a tune with no ambient styles leaves no residue. */
export function upsertTuneSection(doc: string, blockPaths: string[], home: string): string {
  const s = doc.indexOf(TUNE_START);
  const e = doc.indexOf(TUNE_END);
  const without =
    s !== -1 && e !== -1 && e > s ? doc.slice(0, s).trimEnd() + '\n' + doc.slice(e + TUNE_END.length).replace(/^\n+/, '') : doc;
  if (blockPaths.length === 0) return without.trim() ? `${without.trimEnd()}\n` : '';
  const section = tuneSection(blockPaths, home);
  return without.trim() ? `${without.trimEnd()}\n\n${section}\n` : `${section}\n`;
}
