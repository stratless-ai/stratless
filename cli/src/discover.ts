/**
 * DISCOVER — the machine that INVENTS the columns. Everything else in the pipeline works within given
 * categories; this is the one stage that mints them, from the person's own logs, so it works for
 * anyone (not just a seeded machine). A shipped category list is the declared model stratless refuses
 * — so the categories have to come from here, per user, per pile.
 *
 * The discovery CALL is validated (probe 2026-07-21: 14 act-only, correctly-scoped, one-party
 * categories, $0.78). This module is the ORCHESTRATION around it:
 *
 *   - ROUND 0 is BLIND: never told which pile a moment came from (else it finds "the interrupt
 *     category"), never handed counts (assignment counts, on independent work), shown no seed — an
 *     unbiased first read.
 *   - the ROUNDS: discover a sample → assign the leftovers → discover again on what's STILL
 *     unmatched → stop when a round's new categories are too small to ship. One pass finds the loud
 *     moves; the tail only shows in the moments the first pass missed. Later rounds ARE shown the
 *     categories already found and told to add only genuinely NEW kinds — otherwise, since `uniquify`
 *     dedups on exact name only, a leftover round freely re-mints round-0 patterns as synonyms.
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
/** Hard cap so the rounds can never run away. Lowered 4 → 3 (2026-07-23 cost pass): the later rounds
 *  re-score the unmatched tail, the biggest call-count inflator, and STOP_FRACTION already ends early. */
const MAX_ROUNDS = 3;
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
- Name the ACT, not the SUBJECT. "Floats their own approach and asks if it's sound" (the act), never
  "...about pricing" (the subject). The subject changes every time; the act is what recurs.
- A kind must be able to happen again, on a different day, about a different subject.
- Only name a kind you can see happening in MORE THAN ONE conversation (the c-label in brackets).
- Do not sort these into any scheme you already know. The kinds must come from what is actually here.
- Specific to THIS person. A kind that would be true of any developer tells us nothing.
- Mark scope: "person" if it is about how they think or communicate (travels to any project),
  "project" if it is tied to this specific product/tool (competitor research, UI tuning, bug reports).
- Name as many or as few as the material actually supports.
- Write each description plainly: use commas or colons, never an em dash.

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

/**
 * THE JUDGMENT LENS — the second discover prompt. The behavioural prompt above finds what the person
 * DOES; it structurally misses what they CATCH — the sharp evaluative moves (reject a patch job, demand
 * raw output over a summary, interrogate a headline number) get lumped under a coarse "double-checks"
 * behaviour and never surface as their own columns. Proven by the Phase-0 write spike: behavioural-only
 * produced a blunt Judge section; adding this lens produced a sharp one. Same rules as the behavioural
 * prompt (act not subject, recurs across conversations, no em dash) — aimed at the reactions, not the
 * setup. Run ONCE after the behavioural rounds, fed the behavioural categories so it mints only NEW kinds.
 */
const JUDGMENT_PROMPT = `Below are real moments from ONE person's conversations with an AI coding assistant.
Each moment shows what the assistant was doing and saying, then what the person typed back.

This person is the one who JUDGES the work: they catch what is wrong, weak, or unproven before they
trust it. The assistant has infinite skill and no judgment of what is actually good; the person supplies
the judgment. Good judging is CALIBRATED: they check hard where it matters and wave through what does not.

YOUR JOB: find the recurring ways THIS PERSON JUDGES the work: what they refuse to take on faith, what
they interrogate, reject, or demand proof of before accepting it, and where they wave things through.

Judgment shows up in these ways, look across them:
- WHAT THEY CATCH: the specific thing they reliably challenge or refuse, so the assistant should
  pre-empt it: an unverified number, a summary in place of the raw output, a quick fix that leaves debt,
  spend that was not sanctioned, a hedge when a decision is due.
- WHAT PROOF THEY DEMAND: what they need shown before they trust a result (the raw data, the scope
  behind a statistic, the real reason for a decision).
- WHERE THEY EXTEND TRUST: what they wave through fast (small, reversible changes) versus where they
  slow down and check (structural, costly, or one-way decisions).
- HOW THEY CHECK THEIR OWN READ: where they float their own judgment and ask if it is sound first.

Rules:
- Describe how the PERSON judges, from what they actually did. Never rule on whether they were right,
  and never grade them: this is for the assistant to ACT on (to catch these things for them before they
  have to), never a report card handed to the person.
- Name the recurring MOVE, not the SUBJECT. "Interrogates the sample size behind a headline number"
  (the move), never "...about the ingestion stats" (the subject). The subject changes; the move recurs.
- When the person keeps reaching for a particular word or phrasing, quote it: they should recognise
  themselves in it.
- A move must recur across MORE THAN ONE conversation (the c-label in brackets).
- Specific to THIS person's judgment. A check any careful developer makes tells us nothing.
- Mark scope: "person" if the judgment travels to any project, "project" if it is tied to this product.
- Name as many or as few as the material actually supports.
- Write each description plainly: use commas or colons, never an em dash.

Reply with JSON only:
{"categories":[{"name":"short-kebab-name","description":"one sentence naming the judgment move","scope":"person|project"}]}`;

/**
 * The already-found block, injected into rounds 1+ of discovery. Round 0 stays deliberately blind
 * (empty block) for an unbiased first read; every later round is shown the categories already minted
 * and told to propose only genuinely NEW kinds. This is the fix for over-minting: `uniquify` dedups
 * only by exact name, so without this a later round freely re-mints round-0 patterns under synonym
 * names (`asks-for-recap` vs `requests-progress-recap`) — 49 categories where ~20 would do, and every
 * assign prompt then ships all of them. Prompt-only; no extra model calls.
 */
export function knownCategoriesBlock(known: Candidate[]): string {
  if (!known.length) return '';
  const list = known.map((c) => `- ${c.name}: ${c.description}`).join('\n');
  return `\n\nYOU HAVE ALREADY FOUND these kinds from this same person — do NOT propose any of them again, and do NOT propose a synonym or a narrower/broader restatement of one (many moments below simply have not been matched to one of these yet; that is NOT a reason to mint a near-duplicate):\n${list}\n\nPropose ONLY genuinely NEW kinds that none of the above already covers. If nothing new recurs, return an empty list.`;
}

/**
 * From the categories minted so far and the assignments accumulated in `kinds`, the subset that WOULD
 * SURVIVE the final prune on the evidence so far — the only ones safe to feed a later discovery round.
 * A not-yet-proven fluke must NEVER be fed forward: the model could suppress a genuine look-alike as a
 * "restatement" of it, and the fluke is then pruned at the end — silently losing the real category. It
 * REUSES `pruneCategories`, so the confident-check and the final prune are the SAME predicate (the
 * 3-conversation floor AND the circular guard) — neither half can drift from the other, and a category
 * that will be pruned (floor OR circular) can never be fed forward. Erring toward keeping (a few
 * surviving synonyms) beats erring toward loss.
 */
export function confidentCategories(born: Candidate[], kinds: Map<string, Set<string>>, moments: Moment[]): Candidate[] {
  if (!born.length) return [];
  const soFar: Assignment[] = moments.map((m) => ({ key: m.key, at: '', kinds: [...(kinds.get(m.key) ?? [])] }));
  const survivors = pruneCategories(born, soFar, moments);
  return born.filter((c) => survivors.has(c.name));
}

/** One discovery call over a sample of the pool. Thinking left ON (a reasoning task). Returns raw
 *  candidates — validation and uniquifying happen in the loop. `known` is empty on round 0 (the blind
 *  first read) and carries the already-found categories on later rounds, so the model adds only new
 *  kinds instead of re-minting synonyms. */
function discoverCall(bin: string, pool: Moment[], known: Candidate[] = [], prompt: string = DISCOVER_PROMPT): Candidate[] {
  const sample = sampleFor(pool);
  const convId = new Map<string, string>();
  const conv = (s: string): string => (convId.has(s) ? convId.get(s)! : convId.set(s, `c${convId.size + 1}`).get(s)!);
  const input = `${prompt}${knownCategoriesBlock(known)}\n\nMOMENTS:\n\n${sample.map((m, i) => renderBlind(m, i + 1, conv)).join('\n\n')}`;
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

/** THE JUDGMENT PASS as a standalone call: mint the CATCH categories from a pool, told the behavioural
 *  categories already found (`known`) so it proposes only genuinely new kinds. `existing` is the set of
 *  names to hard-skip (defaults to the known names); cold start passes ALL born names. Exposed so cold
 *  start and the dogfood run the SAME lens call — the one artifact worth validating on the real pile. */
export function discoverCatches(bin: string, pool: Moment[], known: Candidate[], existing?: Set<string>): Candidate[] {
  return uniquify(discoverCall(bin, pool, known, JUDGMENT_PROMPT), existing ?? new Set(known.map((c) => c.name)));
}

/** The prune — the harness. A category survives only if its evidence holds: it recurs across the
 *  conversation floor and is not circular (mostly anchor moments). Returns the surviving names.
 *  `exemptCircular` names skip ONLY the circular guard (never the conversation floor): the judgment-lens
 *  CATCHES fire by nature in reactions (interrupt/decline moments), so anchor-concentration is what a
 *  catch IS, not a re-derivation of our labelling — the circular guard would wrongly delete every one. */
export function pruneCategories(
  born: Candidate[],
  records: Assignment[],
  moments: Moment[],
  exemptCircular: Set<string> = new Set(),
): Set<string> {
  const byKey = new Map(moments.map((m) => [m.key, m]));
  const survivors = new Set<string>();
  for (const c of born) {
    const members = records.filter((r) => r.kinds.includes(c.name)).map((r) => byKey.get(r.key)).filter((m): m is Moment => !!m);
    if (new Set(members.map((m) => m.session)).size < MIN_CONVERSATIONS) continue; // the 3-conversation floor
    if (!exemptCircular.has(c.name)) {
      const anchors = members.filter((m) => m.pile !== 'ordinary').length;
      if (members.length && anchors / members.length >= CIRCULAR_ANCHOR_FRAC) continue; // circular
    }
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
    if (!unmatched.length) break; // everything is matched — a discover call over zero moments would pay for nothing
    // The category-minting call is a slow thinking pass with no sub-steps — name the wait so the tail
    // is never a silent hang.
    opts.onProgress?.(r === 0 ? 'discovering the kinds of thing you do…' : `discovering more categories · round ${r + 1}…`);
    // Feed the later rounds the categories already found — but ONLY the CONFIDENT ones (cleared the
    // conversation floor on the evidence so far), never an unproven fluke. `born` is empty on round 0,
    // so round 0 stays blind. uniquify still guards exact-name re-mints against ALL of born.
    const known = confidentCategories(born, kinds, allMoments);
    const candidates = uniquify(discoverCall(bin, unmatched, known), new Set(born.map((c) => c.name)));
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

  // THE JUDGMENT PASS — one lens call after the behavioural rounds. The behavioural sweep finds what the
  // person DOES; this finds what they CATCH. Fed the behavioural categories (confident-only, the same
  // guard the rounds use) so it mints ONLY genuinely new catch kinds. Then a FULL-PILE assign, not just
  // the unmatched tail: a catch ("that's a patch job") co-occurs with moments that already carry a
  // behavioural kind, so it must be scored across everything. Catch names are collected so the final
  // prune can exempt them from the circular guard (a catch is anchor-heavy by nature, not circular).
  const catchNames = new Set<string>();
  if (!opts.shouldStop?.() && allMoments.length) {
    opts.onProgress?.('discovering what you catch…');
    const known = confidentCategories(born, kinds, allMoments);
    const catches = discoverCatches(bin, allMoments, known, new Set(born.map((c) => c.name)));
    if (catches.length) {
      born.push(...catches);
      catches.forEach((c) => catchNames.add(c.name));
      rounds++;
      const jStart = Date.now();
      const { records } = await assignAgainst(bin, allMoments, catches, {
        shouldStop: opts.shouldStop,
        onBatch: (done, tot) => {
          const el = Date.now() - jStart;
          const etaMin = done > 0 ? Math.round(((el / done) * (tot - done)) / 60000) : 0;
          opts.onProgress?.(`scoring what you catch · ${done.toLocaleString()} / ${tot.toLocaleString()} moments${etaMin > 0 ? ` · ~${etaMin} min left` : ''}`);
        },
      });
      for (const rec of records) {
        if (!rec.kinds.length) continue;
        const set = kinds.get(rec.key) ?? kinds.set(rec.key, new Set()).get(rec.key)!;
        rec.kinds.forEach((k) => set.add(k));
      }
      opts.onProgress?.(`judgment pass: +${catches.length} catch categor${catches.length === 1 ? 'y' : 'ies'}`);
    }
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
  const survivors = pruneCategories(born, raw, allMoments, catchNames);
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
  const live = loadCategories();
  const existing = new Set(live.map((c) => c.name));
  // Category-aware here too: show the LIVE categories so the re-mint adds only genuinely-new kinds
  // instead of dripping synonyms back in — the same over-minting cold start now avoids. No confident-only
  // filter is needed here: steady state never prunes/retires a category, so a fed-forward category can
  // never be suppress-THEN-pruned (the cold-start loss mode requires a later prune, which there is none
  // of here) — the whole live set is safe to show.
  const known = live.map((c) => ({ name: c.name, description: c.description, scope: c.scope ?? 'person' }));
  const candidates = uniquify(discoverCall(bin, unmatched, known), existing);
  if (!candidates.length) return [];
  appendCategories(candidates.map((c) => ({ name: c.name, description: c.description, scope: c.scope })));
  return candidates.map((c) => c.name);
}
