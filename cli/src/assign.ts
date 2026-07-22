/**
 * ASSIGN — the checkmarks. The one stage that spends.
 *
 * Given the pile (moments.ts) and a FIXED set of columns (categories.ts), it asks the borrowed
 * assistant, one batch at a time: for each moment, which of these categories are present in what the
 * PERSON did? The list is fixed before the model sees anything — the model can only CHECK, never
 * INVENT (inventing is discovery, stage 3). "None" is a normal, common answer, which is the whole
 * difference from the old `unsorted` box that never fired: a presence check terminates on empty; a
 * sort always reaches for the nearest bin ([[whether-not-which]]).
 *
 * THE STORE — `assignments.jsonl`, append-only, keyed by the moment's content hash:
 *
 *   · ONE RECORD PER MOMENT, WRITTEN ONCE. A moment already in the store is never re-shown — that is
 *     the frozen-once rule (a category born later never relabels an old moment; the store IS the
 *     enforcement). Cold start assigns the whole pile once; every day after assigns only what's new.
 *
 *   · AN EMPTY `kinds: []` IS A REAL RECORD. It means "looked, matched nothing", which is different
 *     from "not looked at yet". Without it a zero-yield moment would be re-billed every single run.
 *
 * THINKING IS CAPPED TO 0. A per-item presence check has no use for extended thinking — measured
 * 43,516 output tokens for a 5,334-token answer, ~3x the bill (see claude.ts). Every call passes 0.
 *
 * --safe-mode rides on every call via runClaude, so the profile is never in context while the
 * profile is being built ([[borrowed-calls-load-human-md]]).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { findAssistant, runClaude } from './claude.js';
import { loadCategories } from './categories.js';
import { loadMoments, type Moment } from './moments.js';

/** Where the checkmarks live. Override with STRATLESS_ASSIGNMENTS (tests). */
const storePath = (): string => process.env.STRATLESS_ASSIGNMENTS || join(homedir(), '.stratless', 'assignments.jsonl');

/** How many moments ride in one call. THE dominant cost lever — 85% of the bill is per-call harness
 *  overhead, so a big batch amortises it (the prototype's 45 was badly chosen). STRATLESS_ASSIGN_BATCH
 *  overrides; 200 measured best. */
const DEFAULT_BATCH = 200;
/** A batch of moments legitimately takes minutes; the default 120s would time out silently. */
const ASSIGN_TIMEOUT_MS = 400_000;
/** A response that judged fewer than this share of its batch is treated as broken (truncated, etc.):
 *  the whole batch re-enters the work list rather than freezing partial silence as matched-nothing. */
const MIN_COVERAGE = 0.5;

function batchSize(): number {
  const n = Number(process.env.STRATLESS_ASSIGN_BATCH);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_BATCH;
}

/** One frozen checkmark row. `at` is when it was assigned — with a category's birth date, the two
 *  timestamps are the entire frozen-once rule. */
export interface Assignment {
  key: string;
  at: string;
  kinds: string[];
}

/** Every stored assignment, in file order. Torn lines (a crash mid-append) are skipped. */
export function loadAssignments(file: string = storePath()): Assignment[] {
  if (!existsSync(file)) return [];
  const out: Assignment[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as Assignment);
    } catch {
      /* torn line — skip */
    }
  }
  return out;
}

/** The keys already assigned — the seen-set that stops a moment being shown (and billed) twice. */
export function assignedKeys(file: string = storePath()): Set<string> {
  return new Set(loadAssignments(file).map((a) => a.key));
}

/** The moments collected but not yet assigned — the "waiting" set the flush gate inspects, and
 *  exactly the work `assignMoments` would consume next run. */
export function pendingMoments(file: string = storePath()): Moment[] {
  const seen = assignedKeys(file);
  return loadMoments().filter((m) => !seen.has(m.key));
}

/** Show the assistant's OPENING only for negative moments — the head is the trigger a reaction like
 *  "why are you coding suddenly?" answers, and it lives nowhere but the opening move. On by default;
 *  STRATLESS_ASSIGN_HEAD=0 suppresses it (the rule is A/B-able — we have not proven it helps). */
const showHead = (): boolean => process.env.STRATLESS_ASSIGN_HEAD !== '0';

/** Render one moment in the shared shape (what the AI ran + said + what the PERSON typed back). The
 *  number is batch-local; the caller maps it back to the moment's key. */
export function renderMoment(m: Moment, n: number): string {
  const head = [`#${n}`];
  if (m.calls) {
    const tools = (m.tools ?? []).join('·');
    head.push(`AI ran: ${tools}${m.calls > (m.tools?.length ?? 0) ? ` (${m.calls} calls)` : ''}`);
  }
  const lines = [head.join('  ')];
  const negative = m.pile === 'interrupt' || m.pile === 'decline';
  if (negative && showHead() && m.aiHead) lines.push(`AI opened: ${m.aiHead}`);
  lines.push(m.aiTail ? `AI said: ${m.aiTail}` : 'AI said: (nothing, it was working)');
  lines.push(`PERSON: ${m.reply}`);
  return lines.join('\n');
}

const PROMPT = (catList: string): string => `You are labelling moments from ONE person's conversations with an AI coding assistant.
Each moment shows what the assistant was doing and saying, then what the person typed back.

Below is a FIXED list of kinds of thing this person does. You may not invent new ones.

For EACH moment, say which of these kinds are present in what the PERSON did.

IMPORTANT:
- A moment may match several kinds, one kind, or NONE. "None" is a normal and common answer —
  most moments in any conversation are ordinary. Return an empty list rather than reaching for the
  nearest match.
- Judge only what the PERSON did. Not the assistant, not whether either was right.
- Use the exact names from the list.

KINDS:
${catList}

Reply with JSON only:
{"assignments":[{"id":<moment number>,"kinds":["exact-name","..."]}]}
Include every moment you were shown, even those with an empty list.`;

const SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'number' }, kinds: { type: 'array', items: { type: 'string' } } },
        required: ['id', 'kinds'],
      },
    },
  },
  required: ['assignments'],
});

interface RawAssignment {
  id: number;
  kinds: string[];
}

/** Pull the assignments array out of a reply. Undefined on anything malformed — the caller then
 *  re-shows the batch rather than trusting a broken parse. */
export function parseAssignments(raw: string): RawAssignment[] | undefined {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return undefined;
  try {
    const parsed = JSON.parse(m[0]) as { assignments?: unknown };
    if (!Array.isArray(parsed.assignments)) return undefined;
    const out: RawAssignment[] = [];
    for (const a of parsed.assignments) {
      const id = Number((a as { id?: unknown })?.id);
      if (!Number.isInteger(id)) continue;
      const rawKinds = (a as { kinds?: unknown })?.kinds;
      const kinds = Array.isArray(rawKinds) ? rawKinds.filter((k): k is string => typeof k === 'string') : [];
      out.push({ id, kinds });
    }
    return out;
  } catch {
    return undefined;
  }
}

/** Assign one batch. Returns one record per moment shown (empty list included), or [] when the call
 *  refused or came back too thin to trust — in which case the whole batch is left unassigned and
 *  re-enters the work list next run. */
function assignBatch(bin: string, batch: Moment[], catList: string, valid: Set<string>): Assignment[] {
  const input = `${PROMPT(catList)}\n\nMOMENTS:\n\n${batch.map((m, i) => renderMoment(m, i + 1)).join('\n\n')}`;
  const raw = runClaude(bin, input, 'sonnet', 'assign', ASSIGN_TIMEOUT_MS, SCHEMA, 0); // thinking capped to 0
  if (!raw) return [];
  const parsed = parseAssignments(raw);
  if (!parsed) return [];

  const byId = new Map<number, string[]>();
  for (const a of parsed) byId.set(a.id, [...new Set(a.kinds.filter((k) => valid.has(k)))]);
  if (byId.size < Math.ceil(batch.length * MIN_COVERAGE)) return []; // too thin — treat as broken

  // A moment the model omitted is treated as matched-nothing: it WAS shown, so re-showing it would
  // re-bill forever. The coverage guard above keeps a truncated response from freezing many at once.
  const at = new Date().toISOString();
  return batch.map((m, i) => ({ key: m.key, at, kinds: byId.get(i + 1) ?? [] }));
}

/** One append of many records — a single write, so a crash tears at most the run boundary. */
function appendAssignments(records: Assignment[], file: string): void {
  if (!records.length) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

/** Replace the whole assignments store — the cold-start build accumulates every moment's kinds in
 *  memory across the discovery rounds and persists them here, once, when the build finishes. */
export function writeAssignments(records: Assignment[], file: string = storePath()): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, records.length ? records.map((r) => JSON.stringify(r)).join('\n') + '\n' : '');
}

export interface AssignResult {
  /** moments newly assigned this run */
  assigned: number;
  /** model calls made */
  batches: number;
  /** live categories assigned against (0 = none yet, nothing was done) */
  categories: number;
  /** true if a stop was requested and the loop bailed between batches (the rest is banked) */
  stopped: boolean;
}

/** The result of assigning a set of moments against a set of categories. */
export interface PileResult {
  /** one record per moment shown (empty kinds included); a too-thin batch is dropped and re-tried */
  records: Assignment[];
  batches: number;
  stopped: boolean;
}

/**
 * THE REUSABLE CORE — assign a given set of moments against a given set of categories, batched, no
 * store I/O of its own. The steady-state path passes `onRecords` to append each batch as it lands
 * (kill-safety: a SIGKILL loses at most the in-flight batch); discover's cold-start rounds omit it
 * and accumulate the returned records in memory, to persist once when the whole build finishes.
 */
export async function assignAgainst(
  bin: string,
  moments: Moment[],
  categories: { name: string; description: string }[],
  opts: { onBatch?: (done: number, total: number) => void; shouldStop?: () => boolean; onRecords?: (records: Assignment[]) => void } = {},
): Promise<PileResult> {
  const valid = new Set(categories.map((c) => c.name));
  const catList = categories.map((c) => `- ${c.name}: ${c.description}`).join('\n');
  const size = batchSize();
  const all: Assignment[] = [];
  let batches = 0;
  let stopped = false;
  for (let i = 0; i < moments.length; i += size) {
    const recs = assignBatch(bin, moments.slice(i, i + size), catList, valid);
    if (recs.length) {
      opts.onRecords?.(recs);
      all.push(...recs);
    }
    batches++;
    opts.onBatch?.(Math.min(i + size, moments.length), moments.length);
    // Breathe: hand the event loop a turn so a pending stop signal's handler can run, then honour it.
    await new Promise((resolve) => setImmediate(resolve));
    if (opts.shouldStop?.()) {
      stopped = true;
      break;
    }
  }
  return { records: all, batches, stopped };
}

/**
 * Assign every not-yet-assigned moment against the live categories, in batches. Idempotent: a second
 * run with nothing new appends nothing and spends nothing. No-op (and honest about it) when there
 * are no categories yet — discovery lands them in stage 3.
 *
 * Serial by design for this first cut: the daily pass is ~1 call, and a cold start's ~25 calls run
 * in a background worker where correctness beats the wall-clock. Concurrency is a later lever.
 *
 * ASYNC so the loop can yield between batches and honour a stop (`opts.shouldStop`) at a checkpoint.
 * Everything already appended is banked, so a stop mid-run neither loses nor re-bills work — the
 * next run's seen-set resumes from the untouched remainder. This is what makes `stop` land within
 * one batch instead of one run (see the cooperative-stop note in loop.ts).
 */
export async function assignMoments(
  opts: { file?: string; onBatch?: (done: number, total: number) => void; shouldStop?: () => boolean } = {},
): Promise<AssignResult> {
  const file = opts.file ?? storePath();
  const cats = loadCategories();
  if (!cats.length) return { assigned: 0, batches: 0, categories: 0, stopped: false };

  const seen = assignedKeys(file);
  const work = loadMoments().filter((m) => !seen.has(m.key));
  if (!work.length) return { assigned: 0, batches: 0, categories: cats.length, stopped: false };

  const bin = findAssistant();
  if (!bin) return { assigned: 0, batches: 0, categories: cats.length, stopped: false }; // no assistant — caller reports

  // Append each batch as it lands (kill-safety); the seen-set resumes the remainder next run.
  const { records, batches, stopped } = await assignAgainst(bin, work, cats, {
    onBatch: opts.onBatch,
    shouldStop: opts.shouldStop,
    onRecords: (recs) => appendAssignments(recs, file),
  });
  return { assigned: records.length, batches, categories: cats.length, stopped };
}
