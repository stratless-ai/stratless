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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { runClaude } from './claude.js';
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
}

const emptyStore = (): PatternStore => ({ v: MINER_V, patterns: [], candidates: [], assignments: {}, audited: {} });

/** Load the store. Missing, corrupt, or version-mismatched reads as empty — rebuilt from the pile. */
export function loadPatterns(file: string = storePath()): PatternStore {
  try {
    if (!existsSync(file)) return emptyStore();
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<PatternStore>;
    if (raw.v !== MINER_V) return emptyStore(); // schema moved — re-mine from the permanent pile
    return {
      v: MINER_V,
      minedAt: typeof raw.minedAt === 'string' ? raw.minedAt : undefined,
      judgedAtLastMine: Number.isFinite(Number(raw.judgedAtLastMine)) ? Number(raw.judgedAtLastMine) : undefined,
      patterns: Array.isArray(raw.patterns) ? (raw.patterns as Pattern[]) : [],
      candidates: Array.isArray(raw.candidates) ? (raw.candidates as Pattern[]) : [],
      assignments: raw.assignments && typeof raw.assignments === 'object' ? (raw.assignments as Record<string, string[]>) : {},
      audited: raw.audited && typeof raw.audited === 'object' ? (raw.audited as Record<string, 1>) : {},
    };
  } catch {
    return emptyStore();
  }
}

export function savePatterns(store: PatternStore, file: string = storePath()): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(store)}\n`);
  } catch {
    /* best-effort — a failed save costs a re-mine, never a crash */
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
  const lines = batch.map((j) => `${j.hash}: ${j.line}`).join('\n');
  const input = `${MINE_PROMPT}\n\nA — EXISTING PATTERNS:\n${sheet || '(none yet — this is the first pass)'}\n\nB — NEW JUDGMENTS:\n${lines}`;

  const raw = runClaude(bin, input, minerModel(), 'miner', MINE_TIMEOUT_MS);
  const mined = raw ? parseMineOutput(raw, new Set(batch.map((j) => j.hash))) : undefined;
  if (!mined) return { store, assigned: 0, deferred: waiting.length, mined: false }; // refuse, retry next gate

  // Merge: existing patterns keep their stored statement (stability; the auditor handles drift);
  // new ids need a statement or they are dropped — no statement, no pattern.
  const byId = new Map<string, ProposedPattern>();
  for (const p of [...store.patterns, ...store.candidates]) {
    byId.set(p.id, { id: p.id, statement: p.statement, kind: p.kind, receipts: [...p.receipts] });
  }
  for (const a of mined) {
    const existing = byId.get(a.id);
    if (existing) existing.receipts.push(...a.newReceipts);
    else if (a.statement) byId.set(a.id, { id: a.id, statement: a.statement, kind: a.kind, receipts: [...a.newReceipts] });
  }

  // Record the assignment for EVERY offered judgment — landed or not, it is never re-sent.
  const landed = new Map<string, string[]>();
  for (const a of mined) for (const h of a.newReceipts) landed.set(h, [...(landed.get(h) ?? []), a.id]);
  for (const j of batch) store.assignments[j.hash] = landed.get(j.hash) ?? [];

  const agg = aggregate([...byId.values()], byHash, opts.now ?? new Date());
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

const AUDIT_PROMPT = `You are the AUDITOR — an independent check on an analyst's claim about ONE
person. Below: a pattern STATEMENT about that person, then the judgment lines assigned to it as
evidence (hash: line).

For EACH line, judge independently: does this judgment actually SATISFY the statement? Not "related
to it" — satisfies it. When uncertain, evict: thin true evidence beats padded evidence.

Output EXACTLY one JSON object, no preamble, no markdown:
{"keep":["<hash>","..."],"evict":["<hash>","..."]}`;

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
 * Audit every pattern's unaudited receipts, one call per pattern. Runs at the gate, after mine().
 * A refused call leaves that pattern's receipts unaudited — re-offered next gate, nothing lost.
 */
export function auditPatterns(
  pile: Judgment[],
  bin: string,
  opts: { now?: Date; file?: string } = {},
): AuditResult {
  const file = opts.file ?? storePath();
  const store = loadPatterns(file);
  const byHash = new Map(pile.map((j) => [j.hash, j]));
  let calls = 0;
  let kept = 0;
  let evicted = 0;

  const evictions = new Map<string, Set<string>>(); // pattern id → hashes to remove
  for (const p of [...store.patterns, ...store.candidates]) {
    const fresh = p.receipts.filter((h) => !store.audited[`${p.id}:${h}`] && byHash.has(h));
    if (!fresh.length) continue;

    const lines = fresh.map((h) => `${h}: ${byHash.get(h)!.line}`).join('\n');
    const input = `${AUDIT_PROMPT}\n\nSTATEMENT: ${p.statement}\n\nEVIDENCE:\n${lines}`;
    const raw = runClaude(bin, input, 'haiku', 'audit');
    calls++;
    const verdict = raw ? parseAuditOutput(raw, new Set(fresh)) : undefined;
    if (!verdict) continue; // refused — these receipts stay unaudited, re-offered next gate

    for (const h of fresh) {
      store.audited[`${p.id}:${h}`] = 1;
      if (verdict.evict.has(h)) evicted++;
      else kept++;
    }
    if (verdict.evict.size) evictions.set(p.id, verdict.evict);
    const prior = p.audit ?? { kept: 0, evicted: 0, at: '' };
    p.audit = {
      kept: prior.kept + (fresh.length - verdict.evict.size),
      evicted: prior.evicted + verdict.evict.size,
      at: (opts.now ?? new Date()).toISOString(),
    };
  }

  // The code removes what the auditor rejected, then arithmetic re-decides admission.
  const proposed: ProposedPattern[] = [...store.patterns, ...store.candidates].map((p) => ({
    id: p.id,
    statement: p.statement,
    kind: p.kind,
    receipts: p.receipts.filter((h) => !evictions.get(p.id)?.has(h)),
  }));
  const audits = new Map([...store.patterns, ...store.candidates].map((p) => [p.id, p.audit]));
  const agg = aggregate(proposed, byHash, opts.now ?? new Date());
  const reattach = (list: Pattern[]) => {
    for (const p of list) if (audits.get(p.id)) p.audit = audits.get(p.id);
  };
  reattach(agg.patterns);
  reattach(agg.candidates);
  store.patterns = agg.patterns;
  store.candidates = agg.candidates;
  savePatterns(store, file);
  return { store, calls, kept, evicted };
}
