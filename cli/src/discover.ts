/**
 * DISCOVER — the machine that INVENTS the columns. Everything else in the pipeline works within given
 * categories; this is the one stage that mints them, from the person's own logs, so it works for
 * anyone (not just a seeded machine). A shipped category list is the declared model stratless refuses
 * — so the categories have to come from here, per user, per pile.
 *
 * The discovery CALL is validated (probe 2026-07-21: 14 act-only, correctly-scoped, one-party
 * categories, $0.78). This module is the ORCHESTRATION around it:
 *
 *   - the call is BLIND: never told which pile a moment came from (else it finds "the interrupt
 *     category"), never handed counts (assignment counts, on independent work), shown no seed.
 *   - the ROUNDS: discover a sample → assign the leftovers → discover again on what's STILL
 *     unmatched → stop when a round's new categories are too small to ship. One pass finds the loud
 *     moves; the tail only shows in the moments the first pass missed.
 *   - the HARNESS is downstream: the model proposes freely, but a category only survives if the
 *     evidence holds — the 3-conversation floor and the circular guard prune the flukes.
 *
 * Cold start is a BATCH: within one build a moment's assignment ACCUMULATES across rounds (matched
 * nothing in round 0 can match in round 1), which is allowed because it is all one build — frozen-once
 * only bites across builds. So the rounds hold everything in memory — the categories in `born`, the
 * checkmarks in `kinds` — and touch disk exactly once, at the end, writing both stores together with
 * one shared build timestamp. That makes cold start ALL-OR-NOTHING: an abrupt death (crash, SIGKILL,
 * a closed laptop) runs no finalize, so nothing is written and the next run re-does the build from an
 * untouched slate — never a half-built set of columns a later run would misread as "already seeded".
 */
import { findAssistant, runClaude } from './claude.js';
import { loadMoments, type Moment } from './moments.js';
import { loadCategories, appendCategories } from './categories.js';
import { assignAgainst, writeAssignments, type Assignment } from './assign.js';
import { MIN_CONVERSATIONS } from './count.js';

/** Blind sample size per discovery call — enough breadth, few enough tokens. */
const SAMPLE_SIZE = 400;
/** Hard cap so the rounds can never run away. */
const MAX_ROUNDS = 4;
/** Stop when a round's new categories absorb fewer than this share of all moments (too small to ship). */
const STOP_FRACTION = 0.02;
/** A category whose members are this fraction anchors (interrupt/decline) re-derives our own
 *  labelling — the pile is BUILT from those events — so it is circular and gets pruned. */
const CIRCULAR_ANCHOR_FRAC = 0.7;
/** Discovery is a reasoning call over ~400 rendered moments; it can think for minutes. */
const DISCOVER_TIMEOUT_MS = 500_000;

export interface Candidate {
  name: string;
  description: string;
  scope: string;
}

/** Balanced deterministic sample: all anchors (interrupts + declines) + an even stride of ordinary.
 *  The anchors are over-represented on purpose — they carry the distress signal — but the render is
 *  identical for every moment, so the model cannot tell an anchor from an ordinary one. */
function sampleFor(pool: Moment[]): Moment[] {
  const anchors = pool.filter((m) => m.pile !== 'ordinary');
  const ordinary = pool.filter((m) => m.pile === 'ordinary').sort((a, b) => (a.key < b.key ? -1 : 1));
  const fill = Math.max(0, SAMPLE_SIZE - anchors.length);
  const stride = Math.max(1, Math.floor(ordinary.length / Math.max(1, fill)));
  return [...anchors, ...ordinary.filter((_, i) => i % stride === 0).slice(0, fill)];
}

/** Render one moment blind — same shape for every pile, no aiHead (which would flag a negative),
 *  conversations tagged c1/c2 so "recurs across conversations" is visible without handing counts. */
function renderBlind(m: Moment, n: number, conv: (s: string) => string): string {
  const head = [`#${n} (${conv(m.session)})`];
  if (m.calls) head.push(`AI ran: ${(m.tools ?? []).join('·')}${m.calls > (m.tools?.length ?? 0) ? ` (${m.calls} calls)` : ''}`);
  return `${head.join('  ')}\n${m.aiTail ? `AI said: ${m.aiTail}` : 'AI said: (nothing, it was working)'}\nPERSON: ${m.reply}`;
}

const DISCOVER_PROMPT = `Below are real moments from ONE person's conversations with an AI coding assistant.
Each moment shows what the assistant was doing and saying, then what the person typed back.

YOUR JOB: find the recurring KINDS OF THING THIS PERSON DOES when they reply.

Rules:
- Describe what the PERSON did. Never describe what the assistant did. Never rule on whether the
  assistant was right, or whether the person understood, agreed, or was satisfied.
- Name the ACT, not the SUBJECT. "Floats their own approach and asks if it's sound" (the act) — never
  "...about pricing" (the subject). The subject changes every time; the act is what recurs.
- A kind must be able to happen again, on a different day, about a different subject.
- Only name a kind you can see happening in MORE THAN ONE conversation (the c-label in brackets).
- Do not sort these into any scheme you already know. The kinds must come from what is actually here.
- Specific to THIS person. A kind that would be true of any developer tells us nothing.
- Mark scope: "person" if it is about how they think or communicate (travels to any project),
  "project" if it is tied to this specific product/tool (competitor research, UI tuning, bug reports).
- Name as many or as few as the material actually supports.

Reply with JSON only:
{"categories":[{"name":"short-kebab-name","description":"one sentence naming the ACT","scope":"person|project"}]}`;

const DISCOVER_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    categories: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, description: { type: 'string' }, scope: { type: 'string' } },
        required: ['name', 'description', 'scope'],
      },
    },
  },
  required: ['categories'],
});

/** One discovery call over a sample of the pool. Thinking left ON (a reasoning task). Returns raw
 *  candidates — validation and uniquifying happen in the loop. */
function discoverCall(bin: string, pool: Moment[]): Candidate[] {
  const sample = sampleFor(pool);
  const convId = new Map<string, string>();
  const conv = (s: string): string => (convId.has(s) ? convId.get(s)! : convId.set(s, `c${convId.size + 1}`).get(s)!);
  const input = `${DISCOVER_PROMPT}\n\nMOMENTS:\n\n${sample.map((m, i) => renderBlind(m, i + 1, conv)).join('\n\n')}`;
  const raw = runClaude(bin, input, 'sonnet', 'discover', DISCOVER_TIMEOUT_MS, DISCOVER_SCHEMA); // no thinking cap
  if (!raw) return [];
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const cats = (JSON.parse(m[0]).categories ?? []) as { name?: unknown; description?: unknown; scope?: unknown }[];
    return cats
      .filter((c) => typeof c.name === 'string' && c.name.trim() && typeof c.description === 'string' && c.description.trim())
      .map((c) => ({ name: (c.name as string).trim(), description: (c.description as string).trim(), scope: c.scope === 'project' ? 'project' : 'person' }));
  } catch {
    return [];
  }
}

/** Drop a candidate whose name already names a live category (a re-proposal), and uniquify any
 *  in-round name collisions — so no two categories can ever share a key. */
export function uniquify(candidates: Candidate[], existing: Set<string>): Candidate[] {
  const used = new Set<string>();
  const out: Candidate[] = [];
  for (const c of candidates) {
    if (existing.has(c.name)) continue; // already live — discover-on-unmatched shouldn't re-propose, but guard
    let name = c.name;
    let i = 2;
    while (used.has(name)) name = `${c.name}-${i++}`;
    used.add(name);
    out.push({ ...c, name });
  }
  return out;
}

/** The prune — the harness. A category survives only if its evidence holds: it recurs across the
 *  conversation floor and is not circular (mostly anchor moments). Returns the surviving names. */
export function pruneCategories(born: Candidate[], records: Assignment[], moments: Moment[]): Set<string> {
  const byKey = new Map(moments.map((m) => [m.key, m]));
  const survivors = new Set<string>();
  for (const c of born) {
    const members = records.filter((r) => r.kinds.includes(c.name)).map((r) => byKey.get(r.key)).filter((m): m is Moment => !!m);
    if (new Set(members.map((m) => m.session)).size < MIN_CONVERSATIONS) continue; // the 3-conversation floor
    const anchors = members.filter((m) => m.pile !== 'ordinary').length;
    if (members.length && anchors / members.length >= CIRCULAR_ANCHOR_FRAC) continue; // circular
    survivors.add(c.name);
  }
  return survivors;
}

export interface DiscoverResult {
  /** categories that survived the prune */
  categories: number;
  /** discovery rounds run */
  rounds: number;
  /** moments in the persisted store */
  assigned: number;
}

/**
 * COLD START — the full rounds. Discovers the whole category set and writes the assignments store
 * once. Assumes a clean slate (no categories / assignments); the caller runs this only when there
 * are none, or as the deliberate re-mint of a cutover.
 */
export async function discover(opts: { onProgress?: (line: string) => void; shouldStop?: () => boolean } = {}): Promise<DiscoverResult> {
  const bin = findAssistant();
  if (!bin) return { categories: 0, rounds: 0, assigned: 0 };
  const allMoments = loadMoments();
  if (!allMoments.length) return { categories: 0, rounds: 0, assigned: 0 };

  const total = allMoments.length;
  const kinds = new Map<string, Set<string>>(); // moment key -> category names, accumulated across rounds
  const born: Candidate[] = [];
  let unmatched = allMoments;
  let rounds = 0;

  for (let r = 0; r < MAX_ROUNDS; r++) {
    if (opts.shouldStop?.()) break;
    // The category-minting call is a slow thinking pass with no sub-steps — name the wait so the tail
    // is never a silent hang.
    opts.onProgress?.(r === 0 ? 'discovering the kinds of thing you do…' : `discovering more categories · round ${r + 1}…`);
    const candidates = uniquify(discoverCall(bin, unmatched), new Set(born.map((c) => c.name)));
    if (!candidates.length) break;
    born.push(...candidates); // in memory only — nothing is written until the build finishes (all-or-nothing)
    rounds++;

    // Live progress for the ~15-min build: a per-batch "scoring N/total · ~M min left" line (round 0
    // covers the whole pile, the bulk of the wait), so the tail always shows real movement + an ETA.
    const roundStart = Date.now();
    const { records } = await assignAgainst(bin, unmatched, candidates, {
      shouldStop: opts.shouldStop,
      onBatch: (done, tot) => {
        const el = Date.now() - roundStart;
        const etaMin = done > 0 ? Math.round(((el / done) * (tot - done)) / 60000) : 0;
        opts.onProgress?.(`scoring your history · ${done.toLocaleString()} / ${tot.toLocaleString()} moments${etaMin > 0 ? ` · ~${etaMin} min left` : ''}`);
      },
    });
    const kindsByKey = new Map(records.map((rec) => [rec.key, rec.kinds]));
    let absorbed = 0;
    const stillUnmatched: Moment[] = [];
    for (const m of unmatched) {
      const ks = kindsByKey.get(m.key) ?? [];
      if (ks.length) {
        const set = kinds.get(m.key) ?? kinds.set(m.key, new Set()).get(m.key)!;
        ks.forEach((k) => set.add(k));
        absorbed++;
      } else {
        stillUnmatched.push(m);
      }
    }
    unmatched = stillUnmatched;
    opts.onProgress?.(`round ${r}: +${candidates.length} categories · absorbed ${absorbed} · ${unmatched.length} still unmatched`);
    if (absorbed < STOP_FRACTION * total) break;
  }

  // ONE build → ONE timestamp → ONE write. Every moment gets a record (empty = "seen, matched
  // nothing"); prune the flukes; then persist the survivors and their checkmarks, both stamped with
  // the same build time. ASSIGNMENTS FIRST, categories second: the two writes are not atomic as a
  // pair, and if the process is killed between them the safe leftover is assignments-WITHOUT-categories
  // — that reads as `!cats.length` → cold start → still consent-gated, no surprise spend. The reverse
  // (categories without assignments) would read as steady state and re-bill the whole pile on the next
  // background flush. A category that failed the prune was never written, so nothing to tombstone.
  const builtAt = new Date().toISOString();
  const raw: Assignment[] = allMoments.map((m) => ({ key: m.key, at: builtAt, kinds: [...(kinds.get(m.key) ?? [])] }));
  const survivors = pruneCategories(born, raw, allMoments);
  writeAssignments(raw.map((rec) => ({ ...rec, kinds: rec.kinds.filter((k) => survivors.has(k)) })));
  appendCategories(
    born.filter((c) => survivors.has(c.name)).map((c) => ({ name: c.name, description: c.description, scope: c.scope })),
    { at: builtAt },
  );

  return { categories: survivors.size, rounds, assigned: allMoments.length };
}

/**
 * STEADY STATE — one round on the recently-unmatched moments, appending any new categories forward.
 * Per frozen-once these accrue only on future moments (the incremental assign picks them up); the
 * current backlog stays unmatched, a known lag we accept under no-backfill. Returns names added.
 */
export function rediscover(unmatched: Moment[]): string[] {
  const bin = findAssistant();
  if (!bin || !unmatched.length) return [];
  const existing = new Set(loadCategories().map((c) => c.name));
  const candidates = uniquify(discoverCall(bin, unmatched), existing);
  if (!candidates.length) return [];
  appendCategories(candidates.map((c) => ({ name: c.name, description: c.description, scope: c.scope })));
  return candidates.map((c) => c.name);
}
