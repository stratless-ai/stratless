/**
 * THE DERIVER — which skills the base map supports (Solo V2, step 3).
 *
 * DISCOVER, deterministic, no catalog (Sun's call, 2026-08-09) — and re-founded a day later by
 * its own acceptance test. The first deriver free-clustered rows into moment families and was
 * FALSIFIED on the reference archive: five embedding bases × two linkage rules all plateaued at
 * 3/6 of the hand-mint's cores, because the hand-mint's big families (altitude, stance, the
 * plan+walkthrough merge) were the author's comprehension — "opposite directions of one dial"
 * unites rows no wording geometry can join. The sweep also showed the free clustering was
 * faithfully re-deriving something else: the store's own fold shelf.
 *
 * So the deriver now derives from what the record actually computes (2026-08-10, Sun's bless):
 *
 *   SEATS — every open mode-1 patch (a when-clause is a moment by construction; the patch
 *   brings the move, the receipts, the native action) and every stored fold (a grouping the
 *   engine already paid for, printed in the profile the person already reads).
 *
 *   STRAYS — un-seated, un-patched rows attach to their single nearest seat when the link
 *   clears ATTACH_FLOOR; otherwise they stay rows. No stray-stray clustering: the measurement
 *   showed those families do not form honestly in this geometry, and a lone row is something
 *   the map already carries perfectly well.
 *
 *   CLASSIFY — a register-anchored unit describes every reply, not a moment: it becomes a
 *   BLOCK (always-loaded, no trigger to race). Patched or offer/catch units become SKILLS.
 *
 * Bigger bundles are the PERSON's call at the door — merge is one keypress, recorded, replayed
 * on every recompile (the voice-cache discipline applied to grouping). The person's editorial
 * is inside the iron gate; the author's is not; the model's wobbles. This is the only judge
 * left standing, and it is the right one.
 */
import type { GroupRecord, RowRecord, TuneInput } from './rows.js';

/**
 * THE ATTACH FLOOR — a named product dial (FOLD_FLOOR precedent), provisional and
 * fixture-calibrated: a stray joins its nearest seat only at or above this link. Set where the
 * fold's floor sits; the live acceptance run records where real strays land, and the frozen
 * expectations in fixture.ts are the regression net under it.
 */
export const ATTACH_FLOOR = 0.61;

export type Embedder = (texts: string[]) => Promise<Float32Array[]>;

/**
 * THE ACTUATOR GATE (Sun's catch, 2026-08-10): not everything on the map is skill-worthy. A fold
 * whose line PREDICTS the person ("expect them to push past vague answers…") is context, not an
 * instruction — a skill wrapping a prediction is a fortune cookie with frontmatter. The map
 * carries three kinds of content: MOVES (imperatives to the assistant → actuators), EXPECTATIONS
 * (predictions about the person → rows), DECODES (phrase→want → trigger vocabulary). Only moves
 * seat units. The check is structural on the voicer's own templated grammar — expectation lines
 * open with a prediction verb — and the frozen fixture is the net under it.
 */
const PREDICTION_OPENERS = new Set(['expect', 'they']);
export const isActuatorLine = (line: string): boolean => {
  const first = line.trim().toLowerCase().split(/\s+/)[0] ?? '';
  return first.length > 0 && !PREDICTION_OPENERS.has(first);
};

/**
 * THE THREE-WAY TAXONOMY (Sun's active/passive probe, 2026-08-10): a unit is an ACTIVE skill
 * (tool-verbs — performs work at its moment), a TRIGGERED style (prose-verbs behind a trigger —
 * conditional register, loaded only when its moment occurs), or an AMBIENT style (register-
 * anchored, always on, nothing to trigger). Active-ness and practicality are the same axis;
 * the stage ladder reads composition off these kinds, so no stage threshold is ever a count.
 */
export type UnitKind = 'active' | 'triggered' | 'ambient';

/** Fold-line openers that command WORK rather than shape a reply — structural on the voicer's
 *  templated grammar (the actuator gate's sibling), with the frozen fixture as the net. */
const ACTION_OPENERS = new Set(['catch']);

/**
 * THE STAGE LADDER (Sun's rule, 2026-08-10, stated flat after the composition detour was
 * rejected): "stage 2 just means more skills derived than stage 1. as simple as it sounds,
 * its not." The rule is a count; the MEANING is a system — at higher stages the skills stop
 * being bolt-ons and cover the task loop end to end, components reinforcing each other (the
 * car law: higher output needs more modifications, and they stop working alone). Two floors:
 * every stage needs at least one ACTIVE skill (a tune with no doing-habit is not a stage),
 * and styles never gate or count — they ride along at every stage. Stage 3 is deliberately
 * the count ceiling (past it, more skills is the measured too-many-skills failure mode);
 * headroom above is 3+ (hooks, v2) and depth channels, not volume.
 */
export type Stage = 'base-map' | 'stage-1' | 'stage-2' | 'stage-3';

export function stageOf(tune: DerivedTune): Stage {
  const skills = tune.units.filter((u) => u.kind === 'active' || u.kind === 'triggered');
  const actives = tune.units.filter((u) => u.kind === 'active');
  if (actives.length === 0) return 'base-map'; // styles-only: the tune is pending its first real habit
  if (skills.length <= 2) return 'stage-1';
  if (skills.length <= 4) return 'stage-2';
  return 'stage-3';
}

/** One derived unit: a seat (patch or fold) plus any strays that attached to it. */
export interface DerivedUnit {
  kind: UnitKind;
  /** deterministic anchor — the highest-count seated member (display naming is the voicer's) */
  anchor: string;
  /** what seated the unit: an open patch's home row, or a stored fold */
  seat: { patchHome?: string; group?: GroupRecord };
  members: RowRecord[];
  /** strays that attached, with the link that admitted them (the receipt for the seating) */
  attached: { row: RowRecord; link: number }[];
}

export interface DerivedTune {
  units: DerivedUnit[];
  /** rows that stay rows — the map carries them; the tune does not */
  leftovers: RowRecord[];
}

const dot = (a: Float32Array, b: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** The text a stray's moment lives in: its voiced line plus the decode signal — all data. */
export const momentText = (r: RowRecord): string => `${r.line} ${r.signal}`.trim();

const anchorOf = (members: RowRecord[]): string =>
  [...members].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))[0]!.name;

const classify = (members: RowRecord[], patched: boolean, seatLine: string): UnitKind => {
  if (patched) return 'active'; // a measured slip on a real seam is work by construction
  if (members.some((m) => m.section === 'register')) return 'ambient';
  const opener = seatLine.trim().toLowerCase().split(/\s+/)[0] ?? '';
  return ACTION_OPENERS.has(opener) ? 'active' : 'triggered';
};

/**
 * Derive the tune from an assembled input. The embedder is injected: production passes the
 * shipped `embedAll`, tests pass a deterministic fake — the derivation itself is arithmetic
 * over whatever vectors arrive, and identical inputs derive identically.
 */
export async function deriveTune(input: TuneInput, embed: Embedder): Promise<DerivedTune> {
  // Seats: stored folds first (their members leave the pool), then open patches.
  const seatedNames = new Set<string>();
  interface Seat {
    patchHome?: string;
    group?: GroupRecord;
    members: RowRecord[];
    text: string;
  }
  const seats: Seat[] = [];
  const expectationRows: RowRecord[] = [];
  for (const g of input.groups) {
    if (g.members.length < 2) continue;
    for (const m of g.members) seatedNames.add(m.name);
    if (!isActuatorLine(g.line)) {
      // The gate: a prediction-shaped fold never seats, and its members are expectation
      // content — they stay rows outright rather than re-entering the pool to attach to a
      // move they aren't.
      expectationRows.push(...g.members);
      continue;
    }
    seats.push({ group: g, members: [...g.members], text: g.line });
  }
  for (const r of input.rows) {
    if (seatedNames.has(r.name) || r.section === 'none') continue;
    if (r.patch && r.patch.state === 'open') {
      seatedNames.add(r.name);
      seats.push({ patchHome: r.name, members: [r], text: r.patch.when || momentText(r) });
    }
  }

  // Strays: everything actuator-eligible that no seat claimed. 'none' rows never mint — the
  // router already said they fit no instruction; they are context, not standards.
  const strays = input.rows.filter((r) => !seatedNames.has(r.name) && r.section !== 'none');

  // One embedding pass covers seats and strays; attachment is nearest-seat, floor-gated,
  // deterministic ties by seat anchor name.
  const texts = [...seats.map((s) => s.text), ...strays.map(momentText)];
  const vectors = texts.length ? await embed(texts) : [];
  const seatVec = (i: number): Float32Array => vectors[i]!;
  const strayVec = (i: number): Float32Array => vectors[seats.length + i]!;

  const attachedTo = new Map<number, { row: RowRecord; link: number }[]>();
  const leftovers: RowRecord[] = [...expectationRows];
  strays.forEach((row, si) => {
    let best: { seat: number; link: number } | undefined;
    seats.forEach((s, i) => {
      const link = dot(strayVec(si), seatVec(i));
      if (link < ATTACH_FLOOR) return;
      if (!best || link > best.link || (link === best.link && anchorOf(s.members) < anchorOf(seats[best.seat]!.members)))
        best = { seat: i, link };
    });
    if (best) {
      const list = attachedTo.get(best.seat) ?? [];
      list.push({ row, link: best.link });
      attachedTo.set(best.seat, list);
    } else {
      leftovers.push(row);
    }
  });

  const units: DerivedUnit[] = seats.map((s, i) => {
    const attached = (attachedTo.get(i) ?? []).sort((a, b) => b.link - a.link || a.row.name.localeCompare(b.row.name));
    const members = [...s.members, ...attached.map((a) => a.row)];
    return {
      kind: classify(members, s.patchHome !== undefined, s.text),
      anchor: anchorOf(s.members),
      seat: { ...(s.patchHome ? { patchHome: s.patchHome } : {}), ...(s.group ? { group: s.group } : {}) },
      members,
      attached,
    };
  });

  units.sort((a, b) => a.anchor.localeCompare(b.anchor));
  leftovers.sort((a, b) => a.name.localeCompare(b.name));
  return { units, leftovers };
}
