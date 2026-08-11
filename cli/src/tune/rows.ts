/**
 * THE COMPILER'S INPUT — the row-record assembler (Solo V2, step 2).
 *
 * The tune is a pure function of the base map, and this module is the whole read: it assembles
 * everything the deriver consumes from the record's own stores — voiced.json (rows, groups),
 * lift.json (patches), and a count tally over assignments.jsonl. The prose HUMAN.md is never
 * read; nothing here calls a model; same store in, same records out, byte for byte.
 *
 * Measured before written (step 0, 2026-08-09): every field below exists in the live stores —
 * including the template's hardest slot, the imperative, which lift already mints as
 * `wording.doThis`. This module adds no engine state and edits no engine file: it is a consumer
 * behind the waist, which is what keeps "the tune is downstream" true at the byte level.
 */
import { loadAssignments } from '../pipeline/assign.js';
import { readLift } from '../pipeline/lift.js';
import type { Patch } from '../pipeline/lift.js';
import { readVoiced } from '../pipeline/voiced.js';
import type { VoicedGroup, VoicedSection } from '../pipeline/voiced.js';

/** The slice of a lift patch the compiler consumes — receipts and wording, never geometry. */
export interface RowPatch {
  /** when the standard fires, in the person's own when-clause */
  when: string;
  /** the imperative the AI executes — the skill template's move slot */
  doThis: string;
  /** the person's own phrasing of the standard (the audit trio's y) */
  ownVoice: string;
  /** the layer-1 mapped native action, when one exists — drive it, never rebuild it */
  action?: string;
  /** birth receipts: the person's reaching, and the times the standard arrived late */
  reach: number;
  slip: number;
  state: Patch['state'];
}

/** One row of the base map, assembled as data: identity + voice + count + any patch riding it. */
export interface RowRecord {
  name: string;
  bornAt: string;
  section: VoicedSection;
  /** the voiced instruction ('' when the row was never voiced) */
  line: string;
  /** the decode-key want ('' when the model offered none) */
  signal: string;
  /** the person's proof phrase — the tune's trigger vocabulary ('' outside register) */
  quote: string;
  /** how often the behaviour occurred — tallied from assignments, never stored */
  count: number;
  patch?: RowPatch;
}

/** A fold, with its members resolved to assembled rows (facets stay aligned to members). */
export interface GroupRecord {
  line: string;
  facets: string[];
  members: RowRecord[];
}

export interface TuneInput {
  rows: RowRecord[];
  groups: GroupRecord[];
  /** the signature numbers the register blocks quote (asks/sessions/bounces, delegated zones) */
  meta: { asks?: number; sessions?: number; bounces?: number; delegatedZones?: number };
}

/** Injectable store paths — tests point these at a synthetic record, prod uses the real one. */
export interface TuneFiles {
  voiced?: string;
  lift?: string;
  assignments?: string;
}

const patchOf = (p: Patch): RowPatch => ({
  when: p.wording.text,
  doThis: p.wording.doThis ?? '',
  ownVoice: p.wording.y ?? '',
  action: p.action,
  reach: p.evidence.reach ?? 0,
  slip: p.evidence.slip ?? 0,
  state: p.state,
});

/**
 * Assemble the compiler's input from one record's stores. Defensive by inheritance: every
 * underlying reader degrades corrupt input to empty rather than throwing, so the worst outcome
 * of a damaged store is a smaller tune, never a wrong one.
 */
export function assembleTuneInput(record: string, files: TuneFiles = {}): TuneInput {
  const voiced = readVoiced(record, files.voiced);
  const lift = readLift(record, files.lift);
  const assignments = loadAssignments(record, files.assignments);

  // Counts are tallied, never stored — the same arithmetic write.ts runs at build time, so the
  // numbers here are the numbers the profile prints (verified against the live store in step 0).
  const counts = new Map<string, number>();
  for (const a of assignments) {
    for (const kind of a.kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  // One patch per home at most in practice; if history ever holds several, the open one wins —
  // an open patch is the live standard, a healed one is the sunset's evidence.
  const patches = new Map<string, Patch>();
  for (const p of lift.patches) {
    const seated = patches.get(p.home);
    if (!seated || (seated.state !== 'open' && p.state === 'open')) patches.set(p.home, p);
  }

  const rows: RowRecord[] = voiced.rows.map((r) => {
    const patch = patches.get(r.name);
    return {
      name: r.name,
      bornAt: r.bornAt,
      section: r.section,
      line: r.line,
      signal: r.signal,
      quote: r.quote,
      count: counts.get(r.name) ?? 0,
      ...(patch ? { patch: patchOf(patch) } : {}),
    };
  });
  const byName = new Map(rows.map((r) => [r.name, r]));

  // Groups resolve members to assembled rows; a member the voiced store no longer carries is
  // dropped WITH its facet so the alignment invariant (one facet per member) survives.
  const groups: GroupRecord[] = (voiced.groups ?? []).map((g: VoicedGroup) => {
    const kept = g.members
      .map((m, i) => ({ row: byName.get(m.name), facet: g.facets[i] ?? '' }))
      .filter((x): x is { row: RowRecord; facet: string } => x.row !== undefined);
    return { line: g.line, facets: kept.map((x) => x.facet), members: kept.map((x) => x.row) };
  });

  return {
    rows,
    groups,
    meta: {
      asks: lift.meta?.asks,
      sessions: lift.meta?.sessions,
      bounces: lift.meta?.bounces,
      delegatedZones: lift.delegatedZones,
    },
  };
}
