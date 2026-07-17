/**
 * MINER — the analyst. Turns the judgment pile into named, counted, evidenced patterns.
 *
 * The division of responsibility (human-md-framework.md): the judge is the witness (one exchange,
 * free description, no categories — repetition is invisible in a sample of one), the miner is the
 * analyst (the whole pile — the first vantage point where a category is an observation, not a
 * guess), the writer is the spokesperson. Categories live HERE, and only here: judgments stay
 * category-free forever (they're cached forever; taxonomies churn), patterns are mortal and
 * rebuildable from the evidence underneath.
 *
 * THE MODEL NAMES; THE CODE COUNTS. This file is the code half — aggregation, weekly buckets,
 * trends, windows, stability, admission, receipts — all deterministic, all testable without a
 * model. The model half (the mining pass that names patterns and assigns judgments) lives behind
 * `mine()` and never touches a number it could hallucinate.
 *
 * Chain of custody (candidate law): claims only weaken downstream. A pattern asserts only what
 * RECURS (admission tests below); every pattern carries its receipts — the judgment hashes that
 * witnessed it — so any claim can be audited back to replies that could have gone the other way
 * (Law 2, falsifiable per claim).
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFileSync, CorruptStoreError } from './atomic.js';
import { runClaude } from './claude.js';
import { runStreamBatch } from './stream.js';
import type { Judgment } from './judge.js';

const STORE = join(homedir(), '.stratless', 'patterns.json');
/** Where the patterns live. Override with STRATLESS_PATTERNS (tests). */
const storePath = (): string => process.env.STRATLESS_PATTERNS || STORE;

/**
 * The mining pipeline's version. Bump when the pattern schema, the kind-set, or the mining
 * question changes materially — a mismatched store is rebuilt from the (permanent) judgment pile,
 * which is exactly why categories never live in the judgment cache.
 */
export const MINER_V = 1;

/**
 * The blessed kind-set (human-md-framework.md, Sun 2026-07-16) — fixed, few, framework-owned.
 * Patterns emerge freely; kinds are the schema they sort into, and the future HUMAN.md sections.
 * `unsorted` is the escape valve: a pattern that fits no kind is NEVER forced into the nearest box
 * — unsorted evidence piling up is the data proposing a new kind (and the Law 3 instrument).
 */
export const KINDS = ['know', 'think', 'work', 'direction', 'failure-signals', 'triggers', 'unsorted'] as const;
export type Kind = (typeof KINDS)[number];

export type Trend = 'rising' | 'steady' | 'fading';
export type Stability = 'volatile' | 'slow' | 'bedrock';
export type Confidence = 'strong' | 'moderate' | 'thin';

/** Admission: a category is a claim about repetition — an anecdote is not a category. */
export const MIN_RECEIPTS = 5;

/** The grading ledger (0.3.2): every pattern is a dated prediction, and this is its scorecard. */
export interface GradeRecord {
  /** windows where new evidence landed on the pattern — reality kept agreeing */
  confirmed: number;
  /** windows where the topic never came up — NEVER a miss (absence of evidence ≠ contradiction) */
  silent: number;
  /** windows where new evidence contradicted the statement — the highest-value signal */
  surprised: number;
  /** the mistakes carry receipts too — auditable error */
  surprises: { at: string; evidence: string[] }[];
  lastGradedAt?: string;
}

export interface Pattern {
  /** stable kebab slug — the pattern's name as an identifier */
  id: string;
  /** the ONE statement every receipt satisfies (cohesion test); free vocabulary, named by the data */
  statement: string;
  kind: Kind;
  /** code-computed, always === receipts.length */
  count: number;
  /** ISO dates (YYYY-MM-DD) of the earliest and latest witnessing receipt */
  window: { from: string; to: string };
  trend: Trend;
  stability: Stability;
  /** judgment hashes that witnessed this pattern — Law 2's falsifiability, made a field */
  receipts: string[];
  confidence: Confidence;
  /** the separate-mind audit tally (0.3.0-5); absent until first audited */
  audit?: { kept: number; evicted: number; at: string };
  /** the prediction scorecard (0.3.2); absent until first graded */
  record?: GradeRecord;
  /** balanced demotion tripped (2 surprises in a window): the next mine must revise or retire it */
  flagged?: boolean;
}

/** What the model half proposes; everything numeric is IGNORED if present — the code recomputes. */
export interface ProposedPattern {
  id?: string;
  statement: string;
  kind: string;
  receipts: string[];
}

export interface PatternStore {
  v: number;
  minedAt?: string;
  /** cachedCount() at the last full mining pass — the mining gate's bookkeeping */
  judgedAtLastMine?: number;
  /** admitted patterns — the only ones the writer may reason from */
  patterns: Pattern[];
  /** below MIN_RECEIPTS — visible to `stratless patterns --all`, never to the writer */
  candidates: Pattern[];
  /** judgment hash → pattern ids. The assignment cache: assigned once, ever, per MINER_V. */
  assignments: Record<string, string[]>;
  /** `${patternId}:${hash}` keys already checked by the auditor — audited once, ever */
  audited: Record<string, 1>;
  /** judgment hashes already used as grading evidence — graded once, ever (0.3.2) */
  graded: Record<string, 1>;
}

const emptyStore = (): PatternStore => ({
  v: MINER_V,
  patterns: [],
  candidates: [],
  assignments: {},
  audited: {},
  graded: {},
});

/**
 * Load the store. Missing reads as empty; a VERSION MISMATCH reads as empty deliberately (the
 * schema moved — re-mining from the permanent pile is the upgrade path, announced by MINER_V);
 * but a DAMAGED file throws CorruptStoreError (C2) — the mine is the bigger half of the bill,
 * and re-running it over corruption would be the same silent re-bill the judgment cache forbids.
 */
export function loadPatterns(file: string = storePath()): PatternStore {
  if (!existsSync(file)) return emptyStore();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new CorruptStoreError(file);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new CorruptStoreError(file);
  const raw = parsed as Partial<PatternStore>;
  if (raw.v !== MINER_V) return emptyStore(); // schema moved — re-mine from the permanent pile
  return {
    v: MINER_V,
    minedAt: typeof raw.minedAt === 'string' ? raw.minedAt : undefined,
    judgedAtLastMine: Number.isFinite(Number(raw.judgedAtLastMine)) ? Number(raw.judgedAtLastMine) : undefined,
    patterns: Array.isArray(raw.patterns) ? (raw.patterns as Pattern[]) : [],
    candidates: Array.isArray(raw.candidates) ? (raw.candidates as Pattern[]) : [],
    assignments: raw.assignments && typeof raw.assignments === 'object' ? (raw.assignments as Record<string, string[]>) : {},
    audited: raw.audited && typeof raw.audited === 'object' ? (raw.audited as Record<string, 1>) : {},
    graded: raw.graded && typeof raw.graded === 'object' ? (raw.graded as Record<string, 1>) : {},
  };
}

/** Save the store atomically (C2). Still best-effort on FAILURE: a failed save leaves the old
 *  store intact on disk (that is what atomic buys) and costs a re-offer next gate, never a crash
 *  mid-pipeline after real spend. */
export function savePatterns(store: PatternStore, file: string = storePath()): void {
  try {
    atomicWriteFileSync(file, `${JSON.stringify(store)}\n`);
  } catch {
    /* best-effort — the old store survives; the next gate re-offers */
  }
}

/** Kebab slug for a pattern id — stable, readable, bounded. */
export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '') || 'pattern'
  );
}

const DAY = 86_400_000;

/**
 * Trend from receipt dates — CODE, not model. v1 rule, deliberately simple and documented:
 * compare the last 28 days against the 28 before. Rising needs real growth (≥ prior + 2, or ≥ 2
 * appearances where there were none); fading is the mirror, and a pattern with no receipt in 56
 * days is fading by definition. Everything else is steady. Dogfooding tunes the constants.
 */
export function computeTrend(dates: string[], now: Date): Trend {
  if (!dates.length) return 'steady';
  const t = now.getTime();
  let recent = 0;
  let prior = 0;
  let any = false;
  for (const d of dates) {
    const x = new Date(d).getTime();
    if (!Number.isFinite(x)) continue;
    any = true;
    const age = t - x;
    if (age <= 28 * DAY) recent++;
    else if (age <= 56 * DAY) prior++;
  }
  if (!any) return 'steady';
  if (recent === 0 && prior === 0) return 'fading'; // every receipt is older than 56 days
  if (recent >= prior + 2 || (prior === 0 && recent >= 2)) return 'rising';
  if (prior >= recent + 2 || (recent === 0 && prior >= 2)) return 'fading';
  return 'steady';
}

/**
 * Stability from the window span — which clock this pattern lives on (the light version of the
 * layered clocks, build-pass §3d). v1 heuristic: seen only inside two weeks = volatile; spanning
 * two months and not fading = bedrock (lean on it); everything between = slow.
 */
export function computeStability(window: { from: string; to: string }, trend: Trend): Stability {
  const span = (new Date(window.to).getTime() - new Date(window.from).getTime()) / DAY;
  if (!Number.isFinite(span) || span < 14) return 'volatile';
  if (span >= 60 && trend !== 'fading') return 'bedrock';
  return 'slow';
}

/**
 * AGGREGATE — rebuild every pattern's numbers from its receipts and the judgment pile. The code
 * half in one function: everything numeric or temporal on a Pattern comes from here and only here.
 *
 * Receipts that don't resolve to a cached judgment are DROPPED at the source (the receipts-lint,
 * applied where receipts are born, not just checked later). Unknown kinds land in `unsorted`,
 * never forced. Admission (count ≥ MIN_RECEIPTS) splits patterns from candidates.
 */
export function aggregate(
  proposed: ProposedPattern[],
  pile: Map<string, Judgment>,
  now: Date,
): { patterns: Pattern[]; candidates: Pattern[] } {
  const patterns: Pattern[] = [];
  const candidates: Pattern[] = [];
  const seenIds = new Set<string>();

  for (const p of proposed) {
    const statement = (p.statement ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!statement) continue; // no statement, no pattern — refuse, don't lie

    // receipts-lint at the source: only hashes that resolve to a real judgment count as evidence
    const receipts = [...new Set(p.receipts ?? [])].filter((h) => pile.has(h));
    if (!receipts.length) continue;

    const dates = receipts
      .map((h) => pile.get(h)!.ts)
      .filter((ts) => Number.isFinite(new Date(ts).getTime()))
      .sort();
    if (!dates.length) continue;

    const kind: Kind = (KINDS as readonly string[]).includes(p.kind) && p.kind !== 'unsorted' ? (p.kind as Kind) : 'unsorted';

    let id = slugify(p.id || statement);
    while (seenIds.has(id)) id = `${id.slice(0, 56)}-2`; // ids stay unique, deterministically
    seenIds.add(id);

    const window = { from: dates[0].slice(0, 10), to: dates[dates.length - 1].slice(0, 10) };
    const trend = computeTrend(dates, now);
    const count = receipts.length;
    const pattern: Pattern = {
      id,
      statement,
      kind,
      count,
      window,
      trend,
      stability: computeStability(window, trend),
      receipts,
      confidence: count >= 15 ? 'strong' : count >= 8 ? 'moderate' : 'thin',
    };
    (count >= MIN_RECEIPTS ? patterns : candidates).push(pattern);
  }

  // Most-evidenced first — the writer reads the strongest claims first, and so does the person.
  const byWeight = (a: Pattern, b: Pattern) => b.count - a.count || a.id.localeCompare(b.id);
  patterns.sort(byWeight);
  candidates.sort(byWeight);
  return { patterns, candidates };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// THE MODEL HALF — the mining pass. Semantic work only: which judgments witness which regularity,
// and what to NAME a regularity no pattern covers yet. It sees ids, statements, and hashes; it is
// never shown a count, a date, or a trend, and nothing numeric it says would be believed anyway —
// aggregate() recomputes everything from receipts.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** The mining model. Naming and equivalence reward a stronger model; the pass is rare and gated. */
const minerModel = (): string => process.env.STRATLESS_MINER_MODEL || 'sonnet';

/**
 * Local-time context for one judgment, CODE-computed — the model receives structured time, never a
 * raw timestamp (the recency-bug lesson, still law). This is what lets time-conditioned patterns
 * ("terser in the morning") emerge through the normal machinery. Exported for tests.
 */
export function timeTag(ts: string): string {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `[${days[d.getDay()]} ${hh}:${mm}] `;
}

/** New judgments offered to one mining pass — the rest wait for the next gate (amortize).
 *  Sized with the timeout below: a bigger batch is fewer calls but longer single-call thinking;
 *  60 keeps one pass inside a sane latency (dogfood 2026-07-17: 120 + a 120s timeout never landed). */
const MINE_BATCH = 60;

/** Mining thinks across dozens of judgments — give it minutes, not the judge's seconds. */
const MINE_TIMEOUT_MS = 300_000;

const MINE_PROMPT = `You are the ANALYST for a model of ONE person, built from their real exchanges
with an AI coding assistant. Below: (A) the existing pattern sheet — named regularities about this
person, each with a stable id; (B) NEW one-line judgments, each with its hash.

Your job is assignment and naming, nothing numeric:
1. For each new judgment, decide which existing pattern(s) it is evidence FOR, if any.
2. Where several new judgments show the SAME regularity that no existing pattern covers, propose a
   NEW pattern: one statement + one kind.

Rules:
- A statement is ONE sentence that every receipt satisfies, specific to THIS person — their topics,
  their moves, their words. A sentence that could describe any developer is a failure; do not write
  it.
- kind, closed set: know · think · work · direction · failure-signals · triggers. If none fits, use
  "unsorted" — never force the nearest box.
- Never invent a hash. Only hashes from section B may appear in new_receipts.
- A judgment may support several patterns, or none — leaving one unassigned is honest work.
- Each judgment carries its local time tag ([Ddd HH:MM], computed by the system, trustworthy). A
  regularity conditioned on time of day or week ("terser and directive in the morning") is a VALID
  pattern — but only when the tags actually support it.
- Statements DESCRIBE the person; they never instruct an assistant what to do.

Output EXACTLY one JSON object, no preamble, no markdown, no code fence:
{"patterns":[{"id":"<existing id, or a new kebab-case id>","statement":"<REQUIRED for new ids, omit for existing>","kind":"<kind>","new_receipts":["<hash>","..."]}]}`;

export interface MinedAssignment {
  id: string;
  statement?: string;
  kind: string;
  newReceipts: string[];
}

/**
 * Parse and VALIDATE the mining reply — the promise layer at the source: hashes not in the offered
 * batch are dropped (the model cannot mint evidence), malformed entries are dropped, an
 * unparseable reply refuses the whole pass (nothing is assigned; the batch is re-offered at the
 * next gate). Exported for tests.
 */
export function parseMineOutput(raw: string, offered: ReadonlySet<string>): MinedAssignment[] | undefined {
  const m = raw.match(/\{[\s\S]*\}/); // greedy — the mining reply is nested JSON
  if (!m) return undefined;
  try {
    const o = JSON.parse(m[0]) as { patterns?: unknown };
    if (!Array.isArray(o.patterns)) return undefined;
    const out: MinedAssignment[] = [];
    for (const p of o.patterns) {
      if (!p || typeof p !== 'object') continue;
      const e = p as Partial<Record<'id' | 'statement' | 'kind' | 'new_receipts', unknown>>;
      const id = slugify(typeof e.id === 'string' ? e.id : '');
      if (!id || id === 'pattern') continue;
      const newReceipts = (Array.isArray(e.new_receipts) ? e.new_receipts : []).filter(
        (h): h is string => typeof h === 'string' && offered.has(h),
      );
      out.push({
        id,
        statement: typeof e.statement === 'string' ? e.statement.replace(/\s+/g, ' ').trim().slice(0, 300) || undefined : undefined,
        kind: typeof e.kind === 'string' ? e.kind.trim().toLowerCase() : 'unsorted',
        newReceipts: [...new Set(newReceipts)],
      });
    }
    return out;
  } catch {
    return undefined;
  }
}

/**
 * aggregate() rebuilds Pattern objects from scratch — correct for the numbers (they must always be
 * recomputed), wrong for the LEDGERS. This reattaches the sticky fields (audit tally, grade
 * record, flagged) by id after any re-aggregation. Found while building 0.3.2: without it, audit
 * tallies silently reset on every mine.
 */
function reattachSticky(before: Pattern[], after: Pattern[], skipAudit?: ReadonlySet<string>): void {
  const sticky = new Map(before.map((p) => [p.id, p]));
  for (const p of after) {
    const s = sticky.get(p.id);
    if (!s) continue;
    if (s.audit && !skipAudit?.has(p.id)) p.audit = s.audit;
    if (s.record) p.record = s.record;
    if (s.flagged) p.flagged = s.flagged;
  }
}

export interface MineResult {
  store: PatternStore;
  /** judgments assigned this pass (each recorded once, ever) */
  assigned: number;
  /** new judgments still waiting because the batch cap was hit */
  deferred: number;
  /** did a model call actually happen */
  mined: boolean;
}

/**
 * One mining pass: offer the un-assigned judgments to the model, merge its assignments into the
 * store, and rebuild every number in code. Assignment is `read once, ever`: every judgment OFFERED
 * is recorded in the assignment cache (even when it landed in no pattern), so no judgment is ever
 * re-sent. A refused/unparseable pass records nothing — the batch simply re-offers next gate.
 */
export function mine(
  pile: Judgment[],
  bin: string,
  opts: { batch?: number; now?: Date; file?: string } = {},
): MineResult {
  const file = opts.file ?? storePath();
  const store = loadPatterns(file);
  const byHash = new Map(pile.map((j) => [j.hash, j]));

  const waiting = pile.filter((j) => !(j.hash in store.assignments));
  const batch = waiting.slice(0, opts.batch ?? MINE_BATCH);
  const deferred = waiting.length - batch.length;
  if (!batch.length) return { store, assigned: 0, deferred, mined: false };

  // (A) the sheet the model reasons against — ids, statements, kinds. No numbers, ever.
  const sheet = [...store.patterns, ...store.candidates]
    .map((p) => `${p.id} [${p.kind}]: ${p.statement}`)
    .join('\n');
  const lines = batch.map((j) => `${j.hash}: ${timeTag(j.ts)}${j.line}`).join('\n');

  // (C) flagged statements — contradicted by graded evidence; the mine must revise or retire them.
  const flagged = store.patterns.filter((p) => p.flagged);
  const flaggedIds = new Set(flagged.map((p) => p.id));
  const contra = (p: Pattern): string =>
    (p.record?.surprises.at(-1)?.evidence ?? [])
      .map((h) => byHash.get(h))
      .filter((j): j is Judgment => !!j)
      .map((j) => `    contradicted by ${j.hash}: ${j.line}`)
      .join('\n');
  const revise = flagged.map((p) => `${p.id}: ${p.statement}\n${contra(p)}`).join('\n');
  const sectionC = flagged.length
    ? `\n\nC — REVISE OR RETIRE (these statements were CONTRADICTED by evidence; you MUST include each id in your output, either with a corrected statement that fits ALL its receipts AND the contradictions, or with the exact statement "RETIRE"):\n${revise}`
    : '';
  const input = `${MINE_PROMPT}\n\nA — EXISTING PATTERNS:\n${sheet || '(none yet — this is the first pass)'}\n\nB — NEW JUDGMENTS:\n${lines}${sectionC}`;

  const raw = runClaude(bin, input, minerModel(), 'miner', MINE_TIMEOUT_MS);
  const mined = raw ? parseMineOutput(raw, new Set(batch.map((j) => j.hash))) : undefined;
  if (!mined) return { store, assigned: 0, deferred: waiting.length, mined: false }; // refuse, retry next gate

  // Merge: existing patterns keep their stored statement (stability; the auditor handles drift) —
  // EXCEPT flagged ones, whose revision is the whole point: a revised statement replaces the old
  // (its audits reset — cohesion must re-earn), and "RETIRE" removes the pattern and releases its
  // evidence back to future mines. New ids need a statement or they are dropped.
  const byId = new Map<string, ProposedPattern>();
  for (const p of [...store.patterns, ...store.candidates]) {
    byId.set(p.id, { id: p.id, statement: p.statement, kind: p.kind, receipts: [...p.receipts] });
  }
  const revisedIds = new Set<string>();
  const retiredIds = new Set<string>();
  for (const a of mined) {
    const existing = byId.get(a.id);
    if (existing) {
      if (flaggedIds.has(a.id) && a.statement) {
        if (a.statement.trim().toUpperCase() === 'RETIRE') {
          byId.delete(a.id);
          retiredIds.add(a.id);
          continue;
        }
        existing.statement = a.statement;
        revisedIds.add(a.id);
      }
      existing.receipts.push(...a.newReceipts);
    } else if (a.statement) {
      byId.set(a.id, { id: a.id, statement: a.statement, kind: a.kind, receipts: [...a.newReceipts] });
    }
  }
  // Retirement releases evidence: those judgments may witness a better pattern someday.
  for (const id of retiredIds) {
    for (const [h, ids] of Object.entries(store.assignments)) {
      const kept = ids.filter((x) => x !== id);
      if (kept.length) store.assignments[h] = kept;
      else delete store.assignments[h];
    }
    for (const key of Object.keys(store.audited)) if (key.startsWith(`${id}:`)) delete store.audited[key];
  }
  // Revision resets the audit ledger for that id — the new statement must re-earn cohesion.
  for (const id of revisedIds) {
    for (const key of Object.keys(store.audited)) if (key.startsWith(`${id}:`)) delete store.audited[key];
  }

  // Record the assignment for EVERY offered judgment — landed or not, it is never re-sent.
  const landed = new Map<string, string[]>();
  for (const a of mined) for (const h of a.newReceipts) landed.set(h, [...(landed.get(h) ?? []), a.id]);
  for (const j of batch) store.assignments[j.hash] = landed.get(j.hash) ?? [];

  const preAggregate = [...store.patterns, ...store.candidates];
  const agg = aggregate([...byId.values()], byHash, opts.now ?? new Date());
  reattachSticky(preAggregate, agg.patterns, revisedIds);
  reattachSticky(preAggregate, agg.candidates, revisedIds);
  // A revised statement sheds its flag and its audit tally — it re-earns both.
  for (const p of [...agg.patterns, ...agg.candidates]) {
    if (revisedIds.has(p.id)) {
      p.flagged = undefined;
      p.audit = undefined;
    }
  }
  store.patterns = agg.patterns;
  store.candidates = agg.candidates;
  store.minedAt = (opts.now ?? new Date()).toISOString();
  store.judgedAtLastMine = pile.length;
  savePatterns(store, file);
  return { store, assigned: batch.length, deferred, mined: true };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// THE AUDITOR — a separate mind, never the one that wrote the statement (0.3.0-5). One cheap call
// per pattern per gate: does each newly-assigned judgment actually SATISFY the statement? The
// model answers keep/evict per receipt; the CODE removes evicted evidence, counts the tally, and
// re-aggregates — so a stretched statement loses its padding and, if it falls under MIN_RECEIPTS,
// demotes to candidate by arithmetic, not by anyone's mercy. Audited once, ever, per
// (pattern, receipt) pair — the same read-once discipline as everything else.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** The auditor's RULES — system-prompt half in streamed sessions, prepended in the fallback. */
const AUDIT_RULES = `You are the AUDITOR — an independent check on an analyst's claims about ONE
person, one claim per message. Each message gives a pattern STATEMENT about that person, then the
judgment lines assigned to it as evidence (hash: line).

For EACH line, judge independently: does this judgment actually SATISFY the statement? Not "related
to it" — satisfies it. When uncertain, evict: thin true evidence beats padded evidence.

Reply to EACH message with EXACTLY one JSON object, no preamble, no markdown:
{"keep":["<hash>","..."],"evict":["<hash>","..."]}`;

/** One audit turn: the statement + its fresh evidence. Rules ride the session's system prompt. */
function auditTurnBody(statement: string, lines: string): string {
  return `STATEMENT: ${statement}\n\nEVIDENCE:\n${lines}`;
}

/**
 * Parse the audit reply. Hashes outside the offered set are ignored; a hash the model failed to
 * mention counts as KEEP (the auditor may only remove what it explicitly rejected — sloppiness
 * must never destroy evidence); a hash in both lists is EVICTED (the prompt says uncertain =
 * evict). Unparseable = refuse the pattern's audit this gate. Exported for tests.
 */
export function parseAuditOutput(raw: string, offered: ReadonlySet<string>): { evict: Set<string> } | undefined {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return undefined;
  try {
    const o = JSON.parse(m[0]) as { keep?: unknown; evict?: unknown };
    if (!Array.isArray(o.keep) && !Array.isArray(o.evict)) return undefined;
    const evict = new Set(
      (Array.isArray(o.evict) ? o.evict : []).filter((h): h is string => typeof h === 'string' && offered.has(h)),
    );
    return { evict };
  } catch {
    return undefined;
  }
}

export interface AuditResult {
  store: PatternStore;
  /** model calls spent (one per pattern with unaudited receipts) */
  calls: number;
  kept: number;
  evicted: number;
}

/**
 * Audit every pattern's unaudited receipts — 0.3.1: through ONE streamed audit session (a turn per
 * pattern; the separate-mind rule holds — the auditor session never wrote any statement), with the
 * per-pattern one-shot as fallback. Runs at the gate, after mine(). A refused/failed turn leaves
 * that pattern's receipts unaudited — re-offered next gate, nothing lost.
 */
export async function auditPatterns(
  pile: Judgment[],
  bin: string,
  opts: { now?: Date; file?: string } = {},
): Promise<AuditResult> {
  const file = opts.file ?? storePath();
  const store = loadPatterns(file);
  const byHash = new Map(pile.map((j) => [j.hash, j]));
  let calls = 0;
  let kept = 0;
  let evicted = 0;

  // Collect the work first: every pattern with receipts not yet audited against its statement.
  const work: { p: Pattern; fresh: string[]; body: string }[] = [];
  for (const p of [...store.patterns, ...store.candidates]) {
    const fresh = p.receipts.filter((h) => !store.audited[`${p.id}:${h}`] && byHash.has(h));
    if (!fresh.length) continue;
    const lines = fresh.map((h) => `${h}: ${byHash.get(h)!.line}`).join('\n');
    work.push({ p, fresh, body: auditTurnBody(p.statement, lines) });
  }

  // Rung 1 — one streamed session, a turn per pattern; rung 2 — per-pattern one-shot fallback.
  const stream = await runStreamBatch(bin, {
    systemPrompt: AUDIT_RULES,
    role: 'audit',
    model: 'haiku',
    feature: 'audit',
    items: work.map((w) => ({ id: w.p.id, prompt: w.body })),
  });

  const evictions = new Map<string, Set<string>>(); // pattern id → hashes to remove
  for (const w of work) {
    let raw = stream.results.get(w.p.id);
    if (raw === undefined) raw = runClaude(bin, `${AUDIT_RULES}\n\n${w.body}`, 'haiku', 'audit');
    calls++;
    const verdict = raw ? parseAuditOutput(raw, new Set(w.fresh)) : undefined;
    if (!verdict) continue; // refused — these receipts stay unaudited, re-offered next gate

    for (const h of w.fresh) {
      store.audited[`${w.p.id}:${h}`] = 1;
      if (verdict.evict.has(h)) evicted++;
      else kept++;
    }
    if (verdict.evict.size) evictions.set(w.p.id, verdict.evict);
    const prior = w.p.audit ?? { kept: 0, evicted: 0, at: '' };
    w.p.audit = {
      kept: prior.kept + (w.fresh.length - verdict.evict.size),
      evicted: prior.evicted + verdict.evict.size,
      at: (opts.now ?? new Date()).toISOString(),
    };
  }

  // The code removes what the auditor rejected, then arithmetic re-decides admission.
  // (grading happens in gradePatterns, after this — see below)
  const proposed: ProposedPattern[] = [...store.patterns, ...store.candidates].map((p) => ({
    id: p.id,
    statement: p.statement,
    kind: p.kind,
    receipts: p.receipts.filter((h) => !evictions.get(p.id)?.has(h)),
  }));
  const preAggregate = [...store.patterns, ...store.candidates];
  const agg = aggregate(proposed, byHash, opts.now ?? new Date());
  reattachSticky(preAggregate, agg.patterns);
  reattachSticky(preAggregate, agg.candidates);
  store.patterns = agg.patterns;
  store.candidates = agg.candidates;
  savePatterns(store, file);
  return { store, calls, kept, evicted };
}

/** The one display order both `patterns` and `receipt` share — kind groups, store order within.
 *  Receipt numbers are session-scoped by design (a re-mine can renumber); the receipt output
 *  restates the claim text, so a stale number is visibly wrong, never silently wrong. */
export function displayOrder(store: PatternStore): Pattern[] {
  const byKind = new Map<string, Pattern[]>();
  for (const p of store.patterns) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);
  return (KINDS as readonly string[]).flatMap((k) => byKind.get(k) ?? []);
}

/** Git-style receipt-hash prefix matching across all admitted patterns. Exported for tests. */
export function matchReceiptPrefix(
  store: PatternStore,
  prefix: string,
): { hash: string; claims: number[] }[] {
  const order = displayOrder(store);
  const hits = new Map<string, number[]>();
  order.forEach((p, i) => {
    for (const h of p.receipts) {
      if (h.startsWith(prefix)) hits.set(h, [...(hits.get(h) ?? []), i + 1]);
    }
  });
  return [...hits.entries()].map(([hash, claims]) => ({ hash, claims }));
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// THE GRADER — the fourth mind (0.3.2). Every admitted pattern is a dated prediction: "this will
// keep happening." Each gate, the window's new evidence grades it. The model does exactly ONE
// semantic thing — cite evidence that CONTRADICTS a claim — and the CODE classifies:
//   contradiction cited            → SURPRISED (the highest-value signal: the model of the person
//                                    is wrong there; the mistake carries receipts too)
//   new receipts landed (overlap)  → CONFIRMED (free, from the assignment arithmetic)
//   neither                        → SILENT (the topic never came up — NEVER a miss; without this
//                                    category every quiet week would erode true patterns)
// Balanced demotion (Sun's call): two surprises inside 14 days flags the statement back to the
// miner — revise or retire. One anomaly costs confidence, not standing. This is Law 2's
// falsifiability made operational: claims are systematically exposed to falsification, on a
// schedule. Graded once, ever, per evidence hash — the same read-once discipline as everything.
// ────────────────────────────────────────────────────────────────────────────────────────────────

const GRADE_RULES = `You are the GRADER — an independent check on whether claims about ONE person
still hold, one claim per message. Each message gives a CLAIM about that person, then NEW EVIDENCE
lines from their recent exchanges (hash: [time] line).

Your ONLY job: cite evidence that CONTRADICTS the claim. The bar is strict — a line contradicts
only if BOTH hold:
1. The situation the claim covers actually AROSE in that line, and
2. the person did the OPPOSITE of what the claim says.

What is NOT a contradiction (never cite these):
- The situation never arose (a different topic, a different kind of moment) — that is SILENCE.
- The person did something merely different or additional, not opposite.
- The claim describes a habit and one line shows a reasonable exception in an unusual context.
Absence of the behavior is NOT the opposite of the behavior.

When in doubt, do not cite. An empty list is the most common correct answer and is honest work.

Reply to EACH message with EXACTLY one JSON object, no preamble, no markdown:
{"contradicts":["<hash>","..."]}`;

/** Contradiction-finding is subtler than one-line verdicts — the grader gets a thinking budget
 *  (the stream default of 0 was tuned for the judge; 7/8 false surprises in the first live grade
 *  taught us the difference, dogfood 2026-07-17). */
const GRADE_THINKING = 1024;

/** The grading model — SONNET by default: the A/B on identical evidence (2026-07-17) showed the
 *  same surprise rate but materially better per-item judgment (haiku cited confirming evidence as
 *  contradiction twice; sonnet correctly confirmed those patterns). The diary is the product's
 *  most trust-sensitive output — the wrong place to save pennies. STRATLESS_GRADER_MODEL overrides. */
const graderModel = (): string => process.env.STRATLESS_GRADER_MODEL || 'sonnet';

/** New evidence offered to one grading pass — the rest waits for the next gate (amortize). */
const GRADE_BATCH = 60;
/** Balanced demotion: this many surprises inside the window flags the statement. */
export const DEMOTE_SURPRISES = 2;
const DEMOTE_WINDOW_DAYS = 14;

/** Parse the grading reply — hashes outside the offered evidence are dropped (no minted
 *  contradictions); unparseable refuses this pattern's grading (re-offered next gate). */
export function parseGradeOutput(raw: string, offered: ReadonlySet<string>): Set<string> | undefined {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return undefined;
  try {
    const o = JSON.parse(m[0]) as { contradicts?: unknown };
    if (!Array.isArray(o.contradicts)) return undefined;
    return new Set(o.contradicts.filter((h): h is string => typeof h === 'string' && offered.has(h)));
  } catch {
    return undefined;
  }
}

/** Classify one pattern's grade — pure code, exported for tests. Contradictions exclude the
 *  pattern's own receipts (cohesion of receipts is the AUDITOR's domain, not the grader's). */
export function classifyGrade(
  cited: ReadonlySet<string>,
  batch: readonly string[],
  receipts: readonly string[],
): { verdict: 'confirmed' | 'silent' | 'surprised'; evidence: string[] } {
  const own = new Set(receipts);
  const contradictions = [...cited].filter((h) => !own.has(h));
  if (contradictions.length) return { verdict: 'surprised', evidence: contradictions };
  const confirmedBy = batch.filter((h) => own.has(h));
  return confirmedBy.length ? { verdict: 'confirmed', evidence: confirmedBy } : { verdict: 'silent', evidence: [] };
}

/** Balanced demotion check — pure, exported for tests. */
export function shouldFlag(record: GradeRecord, now: Date): boolean {
  const cutoff = now.getTime() - DEMOTE_WINDOW_DAYS * 86_400_000;
  const recent = record.surprises.filter((s) => new Date(s.at).getTime() >= cutoff);
  return recent.length >= DEMOTE_SURPRISES;
}

export interface GradeResult {
  store: PatternStore;
  graded: number;
  confirmed: number;
  silent: number;
  surprised: number;
  flagged: number;
}

/**
 * Grade every admitted pattern against the window's ungraded evidence — one streamed session, a
 * turn per pattern, per-pattern one-shot fallback. Candidates are not graded (they never reach the
 * writer, so their being wrong costs nothing yet). A flagged pattern's confidence caps at `thin`
 * until the next mine revises or retires it (chain of custody: claims weaken).
 */
export async function gradePatterns(
  pile: Judgment[],
  bin: string,
  opts: { now?: Date; file?: string } = {},
): Promise<GradeResult> {
  const file = opts.file ?? storePath();
  const store = loadPatterns(file);
  const now = opts.now ?? new Date();
  const result: GradeResult = { store, graded: 0, confirmed: 0, silent: 0, surprised: 0, flagged: 0 };
  if (!store.patterns.length) return result;

  const byHash = new Map(pile.map((j) => [j.hash, j]));
  const batch = pile.filter((j) => !store.graded[j.hash]).slice(-GRADE_BATCH); // newest ungraded
  if (!batch.length) return result;
  const batchHashes = batch.map((j) => j.hash);
  const lines = batch.map((j) => `${j.hash}: ${timeTag(j.ts)}${j.line}`).join('\n');

  const stream = await runStreamBatch(bin, {
    systemPrompt: GRADE_RULES,
    role: 'grade',
    model: graderModel(),
    feature: 'grade',
    maxThinkingTokens: GRADE_THINKING,
    items: store.patterns.map((p) => ({ id: p.id, prompt: `CLAIM: ${p.statement}\n\nNEW EVIDENCE:\n${lines}` })),
  });

  for (const p of store.patterns) {
    let raw = stream.results.get(p.id);
    if (raw === undefined)
      raw = runClaude(bin, `${GRADE_RULES}\n\nCLAIM: ${p.statement}\n\nNEW EVIDENCE:\n${lines}`, graderModel(), 'grade');
    const cited = raw ? parseGradeOutput(raw, new Set(batchHashes)) : undefined;
    if (!cited) continue; // refused — this pattern re-grades next gate, evidence stays ungraded for it

    const grade = classifyGrade(cited, batchHashes, p.receipts);
    const record: GradeRecord = p.record ?? { confirmed: 0, silent: 0, surprised: 0, surprises: [] };
    record[grade.verdict] += 1;
    record.lastGradedAt = now.toISOString();
    if (grade.verdict === 'surprised') {
      record.surprises.push({ at: now.toISOString(), evidence: grade.evidence });
      if (shouldFlag(record, now)) {
        p.flagged = true;
        result.flagged++;
      }
    }
    p.record = record;
    if (p.flagged && p.confidence !== 'thin') p.confidence = 'thin'; // claims only weaken
    result.graded++;
    result[grade.verdict]++;
  }

  // Evidence is graded once, ever — mark the batch regardless of per-pattern refusals (a refused
  // pattern simply has no verdict this window; the evidence itself was offered).
  for (const h of batchHashes) store.graded[h] = 1;
  savePatterns(store, file);
  return result;
}
