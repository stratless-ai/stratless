/**
 * JUDGE — the small read, once per exchange, ever.
 *
 * One question, and only one (handover §4): did understanding transfer, and about WHAT? We do NOT
 * impose a taxonomy of reactions — categories emerge later, in the miner, never here. Each answer
 * is one judgment, cached forever by the exchange's content hash. The rule that keeps the whole
 * product cheap, the one that must never be broken: never re-read what's already read.
 *
 * v2 (0.3.0): the judgment gains structured FORM — {verdict, topic, behavior} parsed from strict
 * one-line JSON and validated in code — while the VOCABULARY stays free (behavior is rich, open
 * description: the raw material every future category emerges from). The form change is why
 * PIPELINE_V now lives in every cache entry: an entry from another pipeline version is stale and
 * re-judged under the normal per-run budget, so a materially better judge actually propagates
 * (build-pass §10, the Clock 2 delivery subtlety) without ever re-spending the whole backlog at
 * once.
 *
 * Cost shape (handover §3): the first run chews the window — a few hundred small Haiku reads, one
 * time. Every run after adds only the handful of new exchanges since. The cache is what makes the
 * difference between "cheap forever" and "a fresh bill every session".
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFileSync, CorruptStoreError } from './atomic.js';
import { runClaude } from './claude.js';
import { runStreamBatch } from './stream.js';
import type { Exchange } from './exchange.js';

const CACHE = join(homedir(), '.stratless', 'judgments.json');
/** Where the cache lives. Override with STRATLESS_CACHE (tests). */
const cachePath = (): string => process.env.STRATLESS_CACHE || CACHE;

/**
 * The judging pipeline's version. Bump it when the judge's question, output form, or view changes
 * materially — entries from other versions are treated as stale and re-judged (bounded by the
 * per-run budget, so a bump amortizes over runs instead of walling one).
 */
export const PIPELINE_V = 2;

export type Verdict = 'transferred' | 'partial' | 'no' | 'none';
const VERDICTS = new Set<string>(['transferred', 'partial', 'no', 'none']);

/** One thing learned about one moment. */
export interface Judgment {
  hash: string;
  ts: string;
  session: string;
  /** which pipeline version judged it — mismatch means stale, re-judge */
  v: number;
  /** the one measurement axis: did understanding transfer? */
  verdict: Verdict;
  /** what the exchange was about — free text, forced only to be concrete */
  topic: string;
  /** what the person actually did — rich, free description; never a category */
  behavior: string;
  /** the rendered one-liner (verdict — topic — behavior), for display and the writer's input */
  line: string;
}

/** Is a cache entry from the current pipeline? (v1 entries have no `v` and fail here.) */
export function currentJudgment(j: Partial<Judgment> | undefined): j is Judgment {
  return !!j && j.v === PIPELINE_V && typeof j.verdict === 'string' && VERDICTS.has(j.verdict);
}

/**
 * The judge's RULES — the instruction half, split from the per-turn exchange (0.3.1). In streamed
 * sessions this rides `--append-system-prompt` (sent once, cached); in the one-shot fallback it is
 * simply prepended. Worded per-message so one set of rules governs a whole streamed session.
 */
export const JUDGE_RULES = `You are studying exchanges between a person and their AI coding
assistant, ONE per message. Your job is to learn about the PERSON, not to grade the assistant's
answer.

Each message gives what the person asked, what the assistant said back, and how the person reacted.
From the REACTION, judge one thing:

  did understanding transfer, and about WHAT?

How to read it:
- The signal is in the REACTION. "ok, next" / "perfect" / moving on = it landed. "wait, what does
  this mean for us" / "i'm lost" / "cant keep up" / a bounced-back question / a redirect to cost or
  direction = it did NOT land.
- topic: name it concretely — "JWT expiry", "the deploy step", "why we need a queue" — never "the
  code" or "the answer".
- behavior: describe what the person actually DID, specifically, in their own words where short.
  Do NOT force it into a fixed category — this rich description is the raw material everything
  later learns from.
- If the reaction carries no signal about understanding (pure logistics, a thank-you), the verdict
  is "none" — but still describe the behavior; even "ok, commit" shows how the person works.

Reply to EACH message with EXACTLY one line of JSON, no preamble, no markdown, no code fence:
{"verdict":"transferred|partial|no|none","topic":"<concrete topic>","behavior":"<what the person did>"}`;

/**
 * THE APERTURE — the judge's per-field view sizes, fitted to THIS user's own history.
 *
 * Every user's conversation shape is different (a log-paster's prompts dwarf a terse asker's), so
 * the view is sized from the user's own window: p90 of real field lengths × a 1.2 safety factor,
 * clamped. Percentile, not mean — the length distributions are long-tailed and a mean lies. The
 * clamps keep a tiny history honest (floors = the 0.2.4 static views) and the worst case
 * publishable (ceilings). Computed IN CODE from the window already in memory — the model never
 * sizes its own view — and cheap to widen at all: the ~20–25k harness overhead per call dwarfs a
 * thousand chars of view (~1.5% of the call). Views are NOT part of the exchange hash, so
 * refitting never invalidates the cache. Recorded in state.json for visibility.
 */
export interface Aperture {
  prompt: number;
  said: number;
  reaction: number;
}

const APERTURE_BOUNDS: Record<keyof Aperture, readonly [number, number]> = {
  prompt: [800, 2400],
  said: [1500, 3500],
  reaction: [800, 1600],
};
const APERTURE_SAFETY = 1.2;

/** The floors — identical to the 0.2.4 static views, used when there is no window to fit from. */
export const DEFAULT_APERTURE: Aperture = { prompt: 800, said: 1500, reaction: 800 };

/** Fit the aperture to a user's window. Pure; exported for tests. */
export function fitAperture(window: Exchange[]): Aperture {
  if (!window.length) return { ...DEFAULT_APERTURE };
  const p90 = (vals: number[]): number => {
    const s = [...vals].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(0.9 * s.length))];
  };
  const fit = (field: keyof Aperture, lengths: number[]): number => {
    const [lo, hi] = APERTURE_BOUNDS[field];
    return Math.max(lo, Math.min(hi, Math.round(p90(lengths) * APERTURE_SAFETY)));
  };
  return {
    prompt: fit('prompt', window.map((e) => e.prompt.length)),
    said: fit('said', window.map((e) => e.said.length)),
    reaction: fit('reaction', window.map((e) => e.reaction.length)),
  };
}

/**
 * Head+tail view of one field, cut marked with `…`. Meaning lives at both ends and the balance
 * differs per field: a prompt leads with the ask (but a log-paster's real question can trail the
 * paste), an assistant turn states its plan up front and its conclusion — the thing the person
 * reacted to — at the end.
 */
function view(s: string, budget: number, headShare: number): string {
  const flat = s.replace(/\s+/g, ' ');
  if (flat.length <= budget) return flat;
  const head = Math.round(budget * headShare);
  const tail = budget - head;
  if (head <= 0) return `…${flat.slice(-tail)}`;
  if (tail <= 0) return `${flat.slice(0, head)}…`;
  return `${flat.slice(0, head)} … ${flat.slice(-tail)}`;
}

/** The per-turn exchange rendering — a streamed turn carries ONLY this (rules ride the system
 *  prompt, sent once per session). Exported for tests. */
export function judgeTurnBody(ex: Exchange, aperture: Aperture = DEFAULT_APERTURE): string {
  return [
    `PERSON ASKED: ${view(ex.prompt, aperture.prompt, 0.7)}`,
    '',
    `ASSISTANT SAID: ${view(ex.said, aperture.said, 0.2)}`,
    '',
    `PERSON REACTED: ${view(ex.reaction, aperture.reaction, 1)}`,
  ].join('\n');
}

/** One-shot judge input — the per-call fallback: rules + exchange in a single prompt. */
export function judgeInput(ex: Exchange, aperture: Aperture = DEFAULT_APERTURE): string {
  return [JUDGE_RULES, '', judgeTurnBody(ex, aperture)].join('\n');
}

/** Build a Judgment from a raw model reply — shared by the streamed and one-shot paths. */
function toJudgment(ex: Exchange, raw: string): Judgment | undefined {
  const parsed = parseJudgeOutput(raw);
  if (!parsed) return undefined;
  return {
    hash: ex.hash,
    ts: ex.ts,
    session: ex.session,
    v: PIPELINE_V,
    ...parsed,
    line: `${parsed.verdict} — ${parsed.topic} — ${parsed.behavior}`,
  };
}

/**
 * Parse and VALIDATE the judge's JSON reply — the form is guaranteed in code, never trusted from
 * the prompt (the promise-layer rule). Tolerates prose around the JSON (takes the first {...}
 * block); refuses on a bad verdict or a missing field — silence over a malformed judgment.
 * Exported for tests.
 */
export function parseJudgeOutput(raw: string): { verdict: Verdict; topic: string; behavior: string } | undefined {
  const m = raw.match(/\{[\s\S]*?\}/);
  if (!m) return undefined;
  try {
    const o = JSON.parse(m[0]) as Partial<Record<'verdict' | 'topic' | 'behavior', unknown>>;
    const verdict = typeof o.verdict === 'string' ? o.verdict.trim().toLowerCase() : '';
    if (!VERDICTS.has(verdict)) return undefined;
    const clean = (v: unknown, cap: number) =>
      typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, cap) : '';
    const topic = clean(o.topic, 120) || (verdict === 'none' ? 'no signal' : '');
    const behavior = clean(o.behavior, 240);
    if (!topic || !behavior) return undefined;
    return { verdict: verdict as Verdict, topic, behavior };
  } catch {
    return undefined;
  }
}

/** Judge a single exchange. Returns undefined if the assistant couldn't answer — silence over guess. */
export function judge(ex: Exchange, bin: string, aperture?: Aperture): Judgment | undefined {
  const raw = runClaude(bin, judgeInput(ex, aperture), 'haiku', 'judge');
  return raw ? toJudgment(ex, raw) : undefined;
}

type Cache = Record<string, Judgment>;

/**
 * How many exchanges have a cached judgment — free and instant, for `status` and the synthesis
 * gate. Counts every entry regardless of pipeline version (an old entry is still a judged
 * exchange; it just re-judges when next seen). Missing reads as zero; a DAMAGED cache throws
 * CorruptStoreError like every other read of it (C2) — the gate must never mistake corruption
 * for an empty pile and trigger a full rebuild over it.
 */
export function cachedCount(file: string = cachePath()): number {
  return Object.keys(loadCache(file)).length;
}

/** The cache's health, for the surfaces that LABEL rather than spend (`status`): ok with a count,
 *  or not ok with the damaged file's path. Never throws. */
export function cacheHealth(file: string = cachePath()): { ok: boolean; count: number; file: string } {
  try {
    return { ok: true, count: cachedCount(file), file };
  } catch {
    return { ok: false, count: 0, file };
  }
}

/** Every current-version judgment in the cache — the miner's whole pile, free to read. */
export function allJudgments(): Judgment[] {
  return Object.values(loadCache()).filter((j) => currentJudgment(j));
}

/** How many FRESH judge calls a run over these exchanges would make (the pre-spend disclosure:
 *  the person hears the bill before the first call, not after). Free — a cache read. */
export function pendingCount(exchanges: Exchange[], limit: number): number {
  const cache = loadCache();
  const unjudged = exchanges.filter((e) => !currentJudgment(cache[e.hash])).length;
  return Math.min(unjudged, limit);
}

/**
 * A missing cache is an empty pile; a DAMAGED cache is a refusal (C2). The old behavior — corrupt
 * reads as `{}` — was the one silent re-bill in the product: every judgment ever paid for would
 * quietly be paid for again. CorruptStoreError propagates to the command layer, which says which
 * file is damaged and how to move it aside; nothing is read or spent past this point.
 */
function loadCache(file: string = cachePath()): Cache {
  if (!existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new CorruptStoreError(file);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new CorruptStoreError(file);
  return parsed as Cache;
}

function saveCache(c: Cache): void {
  atomicWriteFileSync(cachePath(), `${JSON.stringify(c)}\n`);
}

export interface JudgeRun {
  /** every current-version judgment for the given exchanges, in corpus order — cached and fresh together */
  judgments: Judgment[];
  /** how many exchanges we spent a claude call on this run */
  fresh: number;
  /** how many came free from cache */
  cached: number;
  /** exchanges still unjudged (or stale-versioned) because a per-run limit was hit */
  deferred: number;
  /** wall-clock per fresh verdict, streamed and one-shot alike (C8 — the stopwatch's raw material) */
  turnsMs: number[];
}

/**
 * Judge every exchange, reading each only once ever — per pipeline version.
 *
 * 0.3.1: async, with the degradation ladder — STREAM (one harness, many verdicts; measured ~3.2x
 * cheaper and boot-free per turn) → PER-CALL runClaude (older CLIs, mid-batch stream failures) →
 * silence. A cache hit requires the CURRENT version; stale entries re-judge under the same per-run
 * `limit` as everything else, so a version bump drains over runs instead of walling one.
 * `onProgress(done, total)` fires per fresh judgment; checkpoints every 10 exactly as before.
 */
export async function judgeAll(
  exchanges: Exchange[],
  bin: string,
  opts: { limit?: number; aperture?: Aperture; onProgress?: (done: number, total: number) => void } = {},
): Promise<JudgeRun> {
  const cache = loadCache();
  const unjudged = exchanges.filter((e) => !currentJudgment(cache[e.hash]));
  const budget = opts.limit ?? unjudged.length;

  // The attempt set: uncached exchanges up to the budget, in window order.
  const toJudge: Exchange[] = [];
  for (const ex of exchanges) {
    if (currentJudgment(cache[ex.hash])) continue;
    if (toJudge.length >= budget) break;
    toJudge.push(ex);
  }
  const target = toJudge.length;
  let fresh = 0;
  const accept = (ex: Exchange, j: Judgment | undefined): void => {
    if (!j) return; // refused — stays uncached, retried next run
    cache[ex.hash] = j; // overwrites a stale-version entry, if one was there
    fresh++;
    if (fresh % 10 === 0) saveCache(cache); // checkpoint so a crash never re-spends what it read
  };

  // Rung 1 — the stream: one harness, many verdicts. Progress ticks LIVE, per turn — a streamed
  // batch is minutes of otherwise-silent work, and silence reads as a hang (learned by watching).
  // Results are BANKED PER SESSION as they land (C3): a death mid-batch loses at most the chunk
  // in flight, never the paid-for verdicts of the sessions before it.
  const byHash = new Map(toJudge.map((e) => [e.hash, e]));
  const stream = await runStreamBatch(bin, {
    systemPrompt: JUDGE_RULES,
    role: 'judge',
    model: 'haiku',
    feature: 'judge',
    items: toJudge.map((e) => ({ id: e.hash, prompt: judgeTurnBody(e, opts.aperture) })),
    onTurn: (done, total) => opts.onProgress?.(done, total),
    onSessionResults: (chunk) => {
      for (const [hash, text] of chunk) {
        const ex = byHash.get(hash);
        if (ex) accept(ex, toJudgment(ex, text));
      }
      saveCache(cache); // the checkpoint: this chunk's spend is now on disk, kill-safe
    },
  });

  // Rung 2 — the per-call fallback for whatever the stream left behind.
  const turnsMs = [...stream.turnsMs];
  let progressed = stream.completed;
  for (const item of stream.remaining) {
    const ex = byHash.get(item.id);
    if (ex) {
      const t0 = Date.now();
      const j = judge(ex, bin, opts.aperture);
      accept(ex, j);
      if (j) {
        turnsMs.push(Date.now() - t0); // a refused call is not a verdict — its wall stays out of the rates
        saveCache(cache); // bank EVERY fallback verdict (C3): this rung is slow and each one is paid for
      }
    }
    opts.onProgress?.(++progressed, target);
  }
  saveCache(cache);

  // Serve in window order from the now-warm cache — cached and fresh together.
  const judgments = exchanges
    .map((e) => cache[e.hash])
    .filter((j): j is Judgment => currentJudgment(j));
  return { judgments, fresh, cached: judgments.length - fresh, deferred: unjudged.length - target, turnsMs };
}
