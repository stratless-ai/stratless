/**
 * RULES — the gap leg (LIFT layer 2, 2026-07-28).
 *
 * A rule is the gap between a standard the person holds and the sessions where they didn't reach
 * for it in time: `X → do-this → Y`, addressed to the assistant, never a report card to the
 * person. What exists is decided by arithmetic (count.ts gapCandidates — the iron gate is
 * structural: the category IS the person's own words, so Y can never be our opinion); the model's
 * only job here is wording the three fields, ONCE, at mint. The wording is stored and never
 * re-rolled — the write-side wobble class cannot exist for rules by construction.
 *
 * Every rule carries its own death sentence. Each flush build re-measures its gap over a trailing
 * window and applies the pre-registered exits:
 *   · closed     — the slips collapsed while the assistant's supply held, unrefused. Success.
 *   · graduated  — the stumbles stopped while the person kept reaching. The best exit.
 *   · falsified  — enough builds, enough days, and the gap never moved. The rule was wrong; drop.
 *   · dormant    — the rule cannot be honestly re-anchored after a cold rebuild. Kept, silent.
 * Only OPEN rules print. A mirror that graduates you: the success condition is removal.
 *
 * Identity across builds: between cold rebuilds category names are frozen (engine.ts), so a rule
 * anchors by name. A cold rebuild re-mints the whole category set; the rule then re-anchors its
 * BIRTH centroid (its identity — never updated) against the new set, accepted only decisively:
 * best cosine ≥ ANCHOR_MIN with a clear margin over the runner-up, same embedding pipeline.
 * Anything less goes dormant rather than guessing — a false re-anchor would graft one rule's
 * history onto another axis's future.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import { atomicWriteFileSync } from './atomic.js';
import { dot } from './cluster.js';
import { loadEngine } from './engine.js';
import { runClaude } from './claude.js';
import type { Category } from './categories.js';
import {
  gapCandidates,
  gapWindowRead,
  adjacencyOf,
  supplyRead,
  actionFor,
  FADE,
  RECENT_DAYS,
  type Labelled,
  type GapCandidate,
} from './count.js';

const rulesPath = (): string => process.env.STRATLESS_RULES || join(homedir(), '.stratless', 'rules.json');

/* ——— pre-registered lifecycle constants (2026-07-28) — not tunable after the fact ——— */
/** A window must hold at least this many assigned moments before its rates may close or graduate
 *  a rule — a quiet three weeks must never read as a closed gap. */
const SAMPLE_MIN = 100;
/** closed: the recent slip rate sits at or below this share of the birth baseline… */
const CLOSE_FACTOR = 0.5;
/** …for this many consecutive builds. */
const CLOSE_BUILDS = 2;
/** graduated: zero stumble-sessions for this many consecutive builds, with reaching continuing. */
const GRAD_BUILDS = 2;
/** falsified: at least this many builds AND this many days with the slip rate never once dipping
 *  below FALSIFY_FACTOR × baseline. */
const FALSIFY_BUILDS = 6;
const FALSIFY_DAYS = 42;
const FALSIFY_FACTOR = 0.8;
/** re-anchoring after a cold rebuild: best cosine floor and required margin over the runner-up.
 *  The floor sits above the observed cross-category maximum (0.930 on the reference archive). */
const ANCHOR_MIN = 0.93;
const ANCHOR_MARGIN = 0.02;
/** at most this many rules print, slip-heaviest first */
export const PRINT_CAP = 3;
const HISTORY_CAP = 12;
const VOICE_TIMEOUT_MS = 300_000;

export type RuleState = 'open' | 'closed' | 'falsified' | 'graduated' | 'dormant';

export interface RuleHistoryEntry {
  builtAt: string;
  slipRate: number;
  stumbleSessions: number;
  reach: number;
  sample: number;
  supplyRatio?: number;
  declinesRose?: boolean;
}

export interface LiftRule {
  id: string;
  bornAt: string;
  /** the embedding pipeline the centroid lives in — cross-pipeline cosine is meaningless */
  pipeline: string;
  /** the live category this rule reads its gap from; re-derived only at cold-rebuild boundaries */
  anchorName: string;
  /** the BIRTH centroid — the rule's identity. Never updated: re-anchoring compares against this. */
  centroid: number[];
  /** the three voiced fields — written once at mint, never re-rolled. x/doThis/y describe the gap
   *  for the audit trail; `rider` is the PRINTABLE form: one when-clause appended to the rule's
   *  host ADAPT row (the founder's call, 2026-07-28 — a separate section read as schema leakage). */
  x: string;
  doThis: string;
  y: string;
  rider?: string;
  /** the layer-1 mapped action, when one exists — lets `closed` demand the supply held */
  action?: string;
  /** birth evidence, for the receipt and the audit trail */
  reachCount: number;
  slipCount: number;
  stumbleSessions: number;
  /** slip rate over the birth window — what every later build's rate is judged against */
  baseline: number;
  history: RuleHistoryEntry[];
  state: RuleState;
}

interface RulesStore {
  rules: LiftRule[];
}

/** Defensive read — corrupt input degrades to empty, never throws (the renders.json discipline). */
export function readRules(file: string = rulesPath()): RulesStore {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { rules?: unknown };
    if (!Array.isArray(raw.rules)) return { rules: [] };
    const rules: LiftRule[] = [];
    for (const r of raw.rules) {
      if (typeof r !== 'object' || r === null) continue;
      const o = r as Record<string, unknown>;
      if (typeof o.id !== 'string' || typeof o.anchorName !== 'string' || !Array.isArray(o.centroid)) continue;
      if (typeof o.x !== 'string' || typeof o.doThis !== 'string' || typeof o.y !== 'string') continue;
      rules.push({
        id: o.id,
        bornAt: typeof o.bornAt === 'string' ? o.bornAt : '',
        pipeline: typeof o.pipeline === 'string' ? o.pipeline : '',
        anchorName: o.anchorName,
        centroid: o.centroid.filter((n): n is number => typeof n === 'number'),
        x: o.x,
        doThis: o.doThis,
        y: o.y,
        ...(typeof o.rider === 'string' ? { rider: o.rider } : {}),
        ...(typeof o.action === 'string' ? { action: o.action } : {}),
        reachCount: typeof o.reachCount === 'number' ? o.reachCount : 0,
        slipCount: typeof o.slipCount === 'number' ? o.slipCount : 0,
        stumbleSessions: typeof o.stumbleSessions === 'number' ? o.stumbleSessions : 0,
        baseline: typeof o.baseline === 'number' ? o.baseline : 0,
        history: Array.isArray(o.history) ? (o.history as RuleHistoryEntry[]) : [],
        state: o.state === 'closed' || o.state === 'falsified' || o.state === 'graduated' || o.state === 'dormant' ? o.state : 'open',
      });
    }
    return { rules };
  } catch {
    return { rules: [] };
  }
}

export function writeRules(store: RulesStore, file: string = rulesPath()): void {
  atomicWriteFileSync(file, JSON.stringify(store, null, 1));
}

/**
 * Re-anchor a rule against the current category set. Steady state (its name still lives) keeps
 * the name. After a cold rebuild, the birth centroid must claim its new home DECISIVELY or the
 * rule goes dormant — never a guess. Cross-pipeline geometry is refused outright.
 */
export function anchor(
  rule: LiftRule,
  liveNames: Set<string>,
  engine: { labels: string[]; centroids: ArrayLike<number>[]; pipeline: string } | undefined,
): { anchorName: string } | { dormant: true } {
  if (liveNames.has(rule.anchorName)) return { anchorName: rule.anchorName };
  if (!engine || engine.pipeline !== rule.pipeline || !rule.centroid.length) return { dormant: true };
  let best = -1;
  let second = -1;
  let bestIdx = -1;
  for (let i = 0; i < engine.centroids.length; i++) {
    const sim = dot(rule.centroid, engine.centroids[i]);
    if (sim > best) {
      second = best;
      best = sim;
      bestIdx = i;
    } else if (sim > second) {
      second = sim;
    }
  }
  if (bestIdx >= 0 && best >= ANCHOR_MIN && best - second >= ANCHOR_MARGIN && liveNames.has(engine.labels[bestIdx])) {
    return { anchorName: engine.labels[bestIdx] };
  }
  return { dormant: true };
}

/** The exits, applied to a rule's history (oldest → newest). Pure; every threshold above. */
export function nextState(rule: LiftRule, nowMs: number): RuleState {
  const h = rule.history;
  const recent = h.slice(-Math.max(CLOSE_BUILDS, GRAD_BUILDS));
  const solid = (e: RuleHistoryEntry): boolean => e.sample >= SAMPLE_MIN;

  // graduated first — it is the better exit and its condition is stricter than closed's
  const gradSlice = h.slice(-GRAD_BUILDS);
  if (gradSlice.length >= GRAD_BUILDS && gradSlice.every((e) => solid(e) && e.stumbleSessions === 0 && e.reach > 0)) {
    return 'graduated';
  }

  const closeSlice = h.slice(-CLOSE_BUILDS);
  if (closeSlice.length >= CLOSE_BUILDS && closeSlice.every((e) => solid(e) && e.slipRate <= rule.baseline * CLOSE_FACTOR)) {
    const last = closeSlice[closeSlice.length - 1];
    const supplyHolds = !rule.action || (typeof last.supplyRatio === 'number' && last.supplyRatio >= FADE && !last.declinesRose);
    if (supplyHolds) return 'closed';
  }

  const ageDays = (nowMs - Date.parse(rule.bornAt)) / (24 * 3600_000);
  if (h.length >= FALSIFY_BUILDS && ageDays >= FALSIFY_DAYS && h.every((e) => !solid(e) || e.slipRate > rule.baseline * FALSIFY_FACTOR)) {
    return 'falsified';
  }

  void recent;
  return 'open';
}

/* ——— voicing — the model's ONE job here, at mint only ——— */

const RULES_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    rules: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          x: { type: 'string' },
          do: { type: 'string' },
          y: { type: 'string' },
          rider: { type: 'string' },
        },
        required: ['name', 'x', 'do', 'y', 'rider'],
      },
    },
  },
  required: ['rules'],
});

const SAMPLE_CAP = 5;
const SAMPLE_CHARS = 240;

interface VoiceJob {
  candidate: GapCandidate;
  stumbleQuotes: string[];
  reachQuotes: string[];
  action?: string;
}

/** Per-session sample quotes for a category's two valences. `stumbleOnly` narrows the slip side to
 *  named sessions (minting); absent, any slip session serves (the rider backfill). */
function samplesFor(labelled: Labelled[], name: string, stumbleOnly?: Set<string>): { stumbleQuotes: string[]; reachQuotes: string[] } {
  const carry = labelled.filter((l) => l.kinds.includes(name));
  const perSession = (rows: Labelled[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const l of rows) {
      if (seen.has(l.moment.session)) continue;
      const q = l.moment.reply.replace(/\s+/g, ' ').trim().slice(0, SAMPLE_CHARS);
      if (q.length < 10) continue;
      seen.add(l.moment.session);
      out.push(q);
      if (out.length >= SAMPLE_CAP) break;
    }
    return out;
  };
  return {
    stumbleQuotes: perSession(
      carry.filter((l) => (l.moment.pile === 'interrupt' || l.moment.pile === 'decline') && (!stumbleOnly || stumbleOnly.has(l.moment.session))),
    ),
    reachQuotes: perSession(carry.filter((l) => l.moment.pile === 'ordinary')),
  };
}

export function voiceJobs(labelled: Labelled[], candidates: GapCandidate[]): VoiceJob[] {
  const adj = adjacencyOf(labelled);
  return candidates.map((c) => ({
    candidate: c,
    ...samplesFor(labelled, c.name, new Set(c.stumbleSessions)),
    action: actionFor(labelled, c.name, adj),
  }));
}

/**
 * Word the rules. Constraints carried from ADAPT v1 and the framework guardrails: address the
 * assistant, never grade the person; Y is voiced from the person's OWN reach quotes (never our
 * idea of the virtue); portable (no project nouns — name the KIND of thing); grow judgment, never
 * prompting technique.
 */
export function voiceRules(bin: string, jobs: VoiceJob[]): Map<string, { x: string; doThis: string; y: string; rider: string }> {
  const body = jobs
    .map((j) => {
      const parts = [
        `PATTERN: ${j.candidate.name}`,
        `they hold this standard, in their own words (calm, working moments):`,
        ...j.reachQuotes.map((q) => `  · "${q}"`),
        `but in ${j.candidate.stumbleSessions.length} sessions the standard arrived only as a late correction (said while stopping the assistant):`,
        ...j.stumbleQuotes.map((q) => `  · "${q}"`),
      ];
      if (j.action) parts.push(`the assistant move that answers this standard: the ${j.action} tool`);
      return parts.join('\n');
    })
    .join('\n\n');

  const prompt = [
    'You are wording rules for an AI-loaded working brief. Each rule tells the ASSISTANT how to close a',
    'measured gap: the person holds a standard but sometimes deploys it late, and the assistant should',
    'model the move first in exactly those moments. For each PATTERN below give three short fields:',
    '',
    'x  — the stumble, as observed behaviour (≤14 words). Neutral fact, never a criticism.',
    'do — the assistant\'s move at the moment the standard is missing (≤16 words, imperative).',
    'y  — the person\'s own standard, voiced FROM their calm quotes (≤10 words). Their words\' spirit, not yours.',
    'rider — the WHOLE rule as one clause to append to their existing profile row, starting with',
    '        "when" (≤18 words). Written in the file\'s voice — first person is the person ("when I\'ve',
    '        started without one, stop and set the bound for me"). This is the only field that prints.',
    '        THE WHEN MUST DESCRIBE THE MOMENT BEFORE THEY SPEAK: the standard not yet deployed, the',
    '        work already moving. Never "when I\'ve asked and…" — if they had already asked, the gap',
    '        is the assistant\'s failure, not theirs, and that is a different row\'s job.',
    '',
    'Hard rules: address the assistant, never the person (the rider\'s "I/me" is the person\'s voice in',
    'their own file). Never a grade or a diagnosis. No project or product nouns — write the kind of',
    'thing ("their product", "a named tool", "the current build").',
    'The move must grow their judgment (scoping, verifying, deciding), never prompting technique.',
    'Return JSON: {"rules":[{"name","x","do","y","rider"}]} — one entry per PATTERN, name copied exactly.',
    '',
    body,
  ].join('\n');

  const out = new Map<string, { x: string; doThis: string; y: string; rider: string }>();
  const reply = runClaude(bin, prompt, 'sonnet', 'rules', VOICE_TIMEOUT_MS, RULES_SCHEMA, 0);
  if (!reply) return out;
  try {
    const m = reply.match(/\{[\s\S]*\}/);
    if (!m) return out;
    const parsed = JSON.parse(m[0]) as { rules?: { name?: string; x?: string; do?: string; y?: string; rider?: string }[] };
    const known = new Set(jobs.map((j) => j.candidate.name));
    for (const r of parsed.rules ?? []) {
      if (!r.name || !known.has(r.name)) continue;
      if (!r.x || !r.do || !r.y || !r.rider) continue;
      out.set(r.name, { x: r.x.trim(), doThis: r.do.trim(), y: r.y.trim(), rider: r.rider.trim() });
    }
  } catch {
    /* a bad reply mints nothing this build; candidates retry next flush */
  }
  return out;
}

/* ——— the per-build run: evaluate, retire, mint ——— */

export interface RulesRunResult {
  minted: number;
  retired: number;
  open: number;
  /** anything moved — the profile should rebuild */
  changed: boolean;
}

export function runRules(
  bin: string | undefined,
  labelled: Labelled[],
  categories: Category[],
  nowMs: number,
  file: string = rulesPath(),
): RulesRunResult {
  const store = readRules(file);
  const engine = loadEngine();
  const engineView = engine
    ? { labels: engine.labels, centroids: engine.centroids as unknown as ArrayLike<number>[], pipeline: engine.pipeline ?? '' }
    : undefined;
  const liveNames = new Set(categories.map((c) => c.name));
  const builtAt = new Date(nowMs).toISOString();
  let changed = false;
  let retired = 0;

  for (const rule of store.rules) {
    if (rule.state === 'closed' || rule.state === 'falsified' || rule.state === 'graduated') continue; // terminal
    const a = anchor(rule, liveNames, engineView);
    if ('dormant' in a) {
      if (rule.state !== 'dormant') {
        rule.state = 'dormant';
        changed = true;
      }
      continue;
    }
    if (rule.anchorName !== a.anchorName || rule.state === 'dormant') {
      rule.anchorName = a.anchorName;
      rule.state = 'open';
      changed = true;
    }
    const read = gapWindowRead(labelled, rule.anchorName, nowMs);
    const entry: RuleHistoryEntry = { builtAt, ...read };
    if (rule.action) {
      const supply = supplyRead(labelled, rule.anchorName);
      if (supply) {
        entry.supplyRatio = supply.supplyRatio;
        entry.declinesRose = supply.declinesRose;
      }
    }
    rule.history = [...rule.history.filter((e) => e.builtAt !== builtAt), entry].slice(-HISTORY_CAP);
    // The rule is 'open' by construction here (terminal states skipped, dormancy resolved above),
    // so any state change is an exit.
    const next = nextState(rule, nowMs);
    if (next !== rule.state) {
      rule.state = next;
      retired++;
    }
    changed = true; // a history entry was appended
  }

  // One-time rider backfill: an open rule minted before the rider era gets its printable clause
  // voiced at the next flush, then frozen like everything else voiced-once.
  let backfilled = 0;
  const needRider = store.rules.filter((r) => r.state === 'open' && !r.rider);
  if (bin && needRider.length) {
    const jobs: VoiceJob[] = needRider.map((r) => ({
      candidate: { name: r.anchorName, reach: r.reachCount, slip: r.slipCount, slipSessions: 0, stumbleSessions: [], guardedSessions: 0 },
      ...samplesFor(labelled, r.anchorName),
      ...(r.action ? { action: r.action } : {}),
    }));
    const voiced = voiceRules(bin, jobs);
    for (const r of needRider) {
      const v = voiced.get(r.anchorName);
      if (v?.rider) {
        r.rider = v.rider;
        backfilled++;
        changed = true;
      }
    }
  }

  // Mint: candidates with no rule already on that axis, in any state — a dead rule's axis does not
  // silently re-mint (a reopened gap is a conversation for a later layer, not an automatic rebirth).
  const covered = new Set(store.rules.map((r) => r.anchorName));
  const candidates = gapCandidates(labelled, categories).filter((c) => !covered.has(c.name));
  let minted = 0;
  if (bin && candidates.length && engineView) {
    const jobs = voiceJobs(labelled, candidates);
    const voiced = voiceRules(bin, jobs);
    for (const j of jobs) {
      const v = voiced.get(j.candidate.name);
      if (!v) continue;
      const idx = engineView.labels.indexOf(j.candidate.name);
      if (idx < 0) continue; // no geometry, no identity — cannot mint
      const birth = gapWindowRead(labelled, j.candidate.name, nowMs);
      // An unfalsifiable rule may not exist: with no recent slips the baseline is zero and no
      // later movement could ever be judged against it. The gap must be alive to mint.
      if (birth.slipRate <= 0) continue;
      store.rules.push({
        id: `${builtAt}·${j.candidate.name}`,
        bornAt: builtAt,
        pipeline: engineView.pipeline,
        anchorName: j.candidate.name,
        centroid: Array.from(engineView.centroids[idx] as ArrayLike<number>),
        x: v.x,
        doThis: v.doThis,
        y: v.y,
        rider: v.rider,
        ...(j.action ? { action: j.action } : {}),
        reachCount: j.candidate.reach,
        slipCount: j.candidate.slip,
        stumbleSessions: j.candidate.stumbleSessions.length,
        baseline: birth.slipRate,
        history: [{ builtAt, ...birth }],
        state: 'open',
      });
      minted++;
      changed = true;
    }
  }

  if (changed) writeRules(store, file);
  // `changed` for the caller means "what PRINTS moved" — a mint, a retirement, or a rider arriving
  // all change the file; a bare history append does not.
  return { minted, retired, open: store.rules.filter((r) => r.state === 'open').length, changed: minted > 0 || retired > 0 || backfilled > 0 };
}

/* ——— what the profile prints ———
 *
 * A rule never gets its own section (the founder's call, 2026-07-28: a separate section read as
 * schema leakage — "i dont really understand what to take out of that section"). It prints as a
 * RIDER on the host ADAPT row its category already earned, plus a situation-trigger in the decode
 * key. LIFT is the dynamics; ADAPT is the only surface. */

export interface Rider {
  /** the voiced-once when-clause, appended to the host row after " — and " */
  rider: string;
  slip: number;
  /** the GAP's trend, from the rule's own history vs its baseline — two-sided by construction */
  trend?: 'opening' | 'closing';
}

/** Open rules as riders keyed by host category, slip-heaviest first, capped. The clause is the
 *  stored voiced-once text — assembly never re-words. A rule not yet backfilled with a rider
 *  prints nothing (it will be voiced at the next flush). */
export function openRiders(file: string = rulesPath()): Map<string, Rider> {
  const store = readRules(file);
  const out = new Map<string, Rider>();
  const open = store.rules
    .filter((r) => r.state === 'open' && r.rider)
    .sort((a, b) => b.slipCount - a.slipCount)
    .slice(0, PRINT_CAP);
  for (const r of open) {
    const last = r.history[r.history.length - 1];
    let trend: 'opening' | 'closing' | undefined;
    if (last && last.sample >= SAMPLE_MIN && r.baseline > 0) {
      if (last.slipRate >= r.baseline * 1.3) trend = 'opening';
      else if (last.slipRate <= r.baseline * FADE) trend = 'closing';
    }
    out.set(r.anchorName, { rider: r.rider!, slip: r.slipCount, ...(trend ? { trend } : {}) });
  }
  return out;
}
