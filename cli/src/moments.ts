/**
 * MOMENTS — the pile, persisted. The first stage of the discovery pipeline, and the only durable
 * store it keeps.
 *
 * A MOMENT is one thing the person typed paired with what the assistant was doing. It is derived
 * from an `Exchange` (exchange.ts does the pairing) and cached here so the stages above it —
 * assignment, counting, writing — never re-walk transcripts, and so a moment survives its source
 * being reaped (Claude Code deletes transcripts after 30 days; the value is longitudinal).
 *
 * TWO PROPERTIES, both deliberate:
 *
 *   1. APPEND-ONLY JSONL. Adding today's moments must not rewrite yesterday's — that is the mistake
 *      `judgments.json` made (628 KB rewritten to append a handful). It is also the mistake that let
 *      v1's miner lose 84% of its evidence to destructive writes: if the only operation is append,
 *      that entire class of bug cannot occur. A torn last line from a crash mid-append is tolerated —
 *      it fails to parse, is skipped on read, and its moment re-derives cleanly next run.
 *
 *   2. THE SEEN-SET IS THE DEDUP. Moments are keyed by the exchange's content hash; a hash already
 *      in the store is not re-appended. The walk reads the WHOLE archive every run and lets the
 *      seen-set drop what is already here.
 *
 *      An earlier version stopped early — "halt after N consecutive already-stored sessions" — on
 *      the theory that new content sorts newest by file mtime. VERIFIED WRONG (2026-07-21): a new
 *      session whose file sorts behind more than the margin of stored sessions was silently skipped,
 *      forever. mtime order is not a reliable proxy for "already stored" (a restore, a clock skew,
 *      an archived copy with a preserved mtime all break it), and silent data loss is the worst
 *      failure a store can have. The whole walk is ~10s on a 5k-moment archive, in a background
 *      hook — correct beats fast here. A per-file mtime watermark (skip untouched files without
 *      parsing) is the right optimisation later; it needs reader.ts to expose mtimes, so it waits.
 *
 * NO MODEL CALLS. Everything here is code. Cost is zero.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_ROOTS } from './reader.js';
import { iterateExchangesNewestFirst, type Exchange } from './exchange.js';

/** Where the pile lives. Override with STRATLESS_MOMENTS (tests). */
const storePath = (): string => process.env.STRATLESS_MOMENTS || join(homedir(), '.stratless', 'moments.jsonl');

/**
 * The moment shape's version. Bump when the RECORD changes materially — a field added that a stage
 * now reads, the pile rules, the caps. A mismatch rebuilds the pile from scratch (the archive is the
 * durable source; re-walking is free, no model), which is why moments never hold anything a later
 * shape could not re-derive. Independent of the assignment and discovery versions on purpose: a
 * change to what a moment IS should not throw away paid-for assignments, and vice versa.
 */
export const MOMENTS_V = 2; // 2: `denied` added — which tools the person refused (count reads it)

/** The reply is stored capped — enough to read and to quote from, not the whole paste. The TRUE
 *  length rides alongside in `replyLen`, because size is itself a signal and the cap would hide it. */
const REPLY_CAP = 800;
/** How much of the assistant's opening / ending a moment keeps. The exchange holds more; a moment
 *  needs only enough to recognise the move. */
const HEAD = 300;
const TAIL = 300;

export type Pile = 'interrupt' | 'decline' | 'ordinary';

/** One persisted moment. Every field is read by a named stage (see the record decision, 2026-07-21);
 *  nothing is carried "just in case". Optional fields are absent, never null. */
export interface Moment {
  /** the exchange's content hash — the identity, and the dedup key */
  key: string;
  /** which conversation — the 3-DIFFERENT-conversations admission floor, and the scoreboard */
  session: string;
  /** ISO timestamp of the reply — trend direction, and the time-split */
  ts: string;
  /** what recorded EVENT the moment carries — the split the file is built on, and (at assignment)
   *  which moments are shown the assistant's opening as well as its ending */
  pile: Pile;
  /** what the person typed, capped */
  reply: string;
  /** the TRUE length of the reply, before the cap — quote selection, and the only size signal */
  replyLen: number;
  /** distinct tool names the assistant ran — WHAT it was doing. Absent on a pure-talk turn. */
  tools?: string[];
  /** total invocations, duplicates kept — HOW MUCH (twelve edits vs one). Absent on a pure-talk turn. */
  calls?: number;
  /** distinct tool names the person REFUSED here — the other half of the supply question: an offer
   *  kept being made vs an offer kept being taken. Absent when nothing was refused. */
  denied?: string[];
  /** the OPENING of the assistant's turn — the trigger. Absent when it said nothing. */
  aiHead?: string;
  /** the ENDING of the assistant's turn — what the reply answered. Absent when it said nothing. */
  aiTail?: string;
}

/** The recorded event decides the pile — never inference. A declined tool is the stronger, explicit
 *  signal, so it wins over a bare interrupt; a 'tool-use' interrupt without a decline is the tail of
 *  a permission flow and is not counted as a spontaneous course correction (it lands in ordinary). */
export function pileOf(ex: Exchange): Pile {
  if (ex.declined) return 'decline';
  if (ex.interrupted === 'plain') return 'interrupt';
  return 'ordinary';
}

/** Derive a moment from an exchange. Pure. */
export function toMoment(ex: Exchange): Moment {
  const m: Moment = {
    key: ex.hash,
    session: ex.session,
    ts: ex.ts,
    pile: pileOf(ex),
    reply: ex.reaction.slice(0, REPLY_CAP),
    replyLen: ex.shape?.reply ?? ex.reaction.length,
  };
  if (ex.tools?.length) {
    m.tools = [...new Set(ex.tools)];
    m.calls = ex.tools.length;
  }
  if (ex.denied?.length) m.denied = [...new Set(ex.denied)];
  // Head and tail travel together or not at all: both are absent exactly when the assistant said
  // nothing (an opener, a tool-only turn), which is honest — there was no opening move to record.
  if (ex.said) m.aiTail = ex.said.slice(-TAIL);
  if (ex.saidHead) m.aiHead = ex.saidHead.slice(0, HEAD);
  return m;
}

/** The keys already in the store — the seen-set / watermark. Torn lines (a crash mid-append) fail
 *  to parse and are skipped; their moment simply re-derives. */
function storedKeys(file: string): Set<string> {
  const keys = new Set<string>();
  if (!existsSync(file)) return keys;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      keys.add((JSON.parse(line) as Moment).key);
    } catch {
      /* torn line — skip; the moment re-derives next run */
    }
  }
  return keys;
}

/** Every stored moment, in file order (append order, so roughly oldest-batch first). Callers that
 *  need chronological order sort by `ts`; nothing relies on file order. */
export function loadMoments(file: string = storePath()): Moment[] {
  if (!existsSync(file)) return [];
  const out: Moment[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as Moment);
    } catch {
      /* torn line — skip */
    }
  }
  return out;
}

export interface BuildResult {
  /** moments appended this run */
  added: number;
  /** distinct moments in the store after this run */
  total: number;
  /** exchanges walked — the whole archive every run, the cost in transcripts parsed */
  scanned: number;
}

/**
 * Read what is new and append it. Walks the whole archive, dedups against what is stored, appends
 * the rest. Idempotent: a second run with no new transcripts appends nothing. Safe to point at one
 * file or the whole archive — the result is identical either way, because the seen-set decides what
 * is new, not the input, and there is no early stop that could depend on walk order.
 *
 * The version gate: a MOMENTS_V mismatch means the shape moved, so the whole pile is rebuilt from
 * the archive rather than appended to. Detected by a one-line meta sidecar; its absence (an old
 * store from before versioning, or a fresh machine) is treated as current, since a v1 store and a
 * versionless store are the same shape.
 */
export function buildMoments(opts: { roots?: string[]; file?: string } = {}): BuildResult {
  const file = opts.file ?? storePath();
  const roots = opts.roots ?? DEFAULT_ROOTS;

  const stale = readMeta(file) !== MOMENTS_V;
  const seen = stale ? new Set<string>() : storedKeys(file);

  const fresh: Moment[] = [];
  let scanned = 0;

  // Walk the WHOLE archive, every run. The seen-set drops what is already stored; there is no early
  // stop, because no cheap ordering reliably says "everything past here is stored" (see the header).
  for (const ex of iterateExchangesNewestFirst(roots)) {
    scanned++;
    if (seen.has(ex.hash)) continue;
    seen.add(ex.hash);
    fresh.push(toMoment(ex));
  }

  if (stale) {
    // The shape moved: replace the file wholesale rather than append onto a mixed-shape pile.
    mkdirSync(dirname(file), { recursive: true });
    // fresh is newest-first; write oldest-first so the file reads chronologically.
    appendOrReplace(file, fresh.slice().reverse(), 'replace');
    writeMeta(file);
  } else if (fresh.length) {
    appendOrReplace(file, fresh.slice().reverse(), 'append');
    writeMeta(file);
  }

  return { added: fresh.length, total: seen.size, scanned };
}

/** One place that turns moments into lines and puts them on disk, appending or replacing. Append is
 *  a single write so a crash tears at most the boundary between runs, never between two moments of
 *  one run. */
function appendOrReplace(file: string, moments: Moment[], mode: 'append' | 'replace'): void {
  const data = moments.length ? moments.map((m) => JSON.stringify(m)).join('\n') + '\n' : '';
  mkdirSync(dirname(file), { recursive: true });
  if (mode === 'replace') {
    // Truncate then write — a rebuild is rare (a version bump) and correctness beats atomicity here.
    appendFileSync(file, '', { flag: 'w' });
  }
  if (data) appendFileSync(file, data);
}

// ── the version sidecar ─────────────────────────────────────────────────────────────────────────
// A JSONL file has no header, so the version lives beside it. Kept trivially small and separate so
// reading the pile never has to parse past a header line.

const metaPath = (file: string): string => `${file}.v`;

function readMeta(file: string): number {
  try {
    return Number(readFileSync(metaPath(file), 'utf8').trim()) || 0;
  } catch {
    // No sidecar: a fresh store, or one written before versioning existed. Both are shape v1, so an
    // absent sidecar reads as current rather than forcing a needless rebuild.
    return existsSync(file) ? MOMENTS_V : 0;
  }
}

function writeMeta(file: string): void {
  try {
    appendFileSync(metaPath(file), `${MOMENTS_V}\n`, { flag: 'w' });
  } catch {
    /* best-effort: a missing sidecar just triggers one rebuild next run, never a crash */
  }
}
