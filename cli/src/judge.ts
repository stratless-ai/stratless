/**
 * JUDGE — the small read, once per exchange, ever.
 *
 * One question, and only one (handover §4): did understanding transfer, and about WHAT? We do NOT
 * impose a taxonomy of reactions — those must emerge from the pile later. Each answer is one line,
 * cached forever by the exchange's content hash. The rule that keeps the whole product cheap, the
 * one that must never be broken: never re-read what's already read.
 *
 * Cost shape (handover §3): the first run chews the backlog — a few hundred small Haiku reads, one
 * time. Every run after adds only the handful of new exchanges since. The cache is what makes the
 * difference between "cheap forever" and "a fresh bill every session".
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runClaude } from './claude.js';
import type { Exchange } from './exchange.js';

const STRATLESS = join(homedir(), '.stratless');
const CACHE = join(STRATLESS, 'judgments.json');

/** One line learned about one moment. */
export interface Judgment {
  hash: string;
  ts: string;
  session: string;
  /** the single line back from claude -p */
  line: string;
}

const PROMPT = `You are studying ONE exchange between a person and their AI coding assistant. Your
job is to learn about the PERSON, not to grade the assistant's answer.

You are given what the person asked, what the assistant said back, and how the person reacted. From
the REACTION, judge one thing and report it in one line:

  did understanding transfer, and about WHAT?

How to read it:
- The signal is in the REACTION. "ok, next" / "perfect" / moving on = it landed. "wait, what does
  this mean for us" / "i'm lost" / "cant keep up" / a bounced-back question / a redirect to cost or
  direction = it did NOT land.
- Name the TOPIC concretely — "JWT expiry", "the deploy step", "why we need a queue" — never "the
  code" or "the answer".
- Do NOT force the reaction into a fixed category. Describe what the person actually did.
- If the reaction carries no signal about understanding (pure logistics, a thank-you), say: none

Output EXACTLY one line, no preamble, no markdown, in this shape:
<transferred|partial|no|none> — <topic> — <what the person did, in a few words>`;

/** Judge a single exchange. Returns undefined if the assistant couldn't answer — silence over guess. */
export function judge(ex: Exchange, bin: string): Judgment | undefined {
  const input = [
    PROMPT,
    '',
    `PERSON ASKED: ${ex.prompt.replace(/\s+/g, ' ').slice(0, 800)}`,
    '',
    `ASSISTANT SAID: ${ex.said.replace(/\s+/g, ' ').slice(0, 1500)}`,
    '',
    `PERSON REACTED: ${ex.reaction.replace(/\s+/g, ' ').slice(0, 800)}`,
  ].join('\n');

  const raw = runClaude(bin, input, 'haiku');
  if (!raw) return undefined;
  const line = raw.split('\n').find((l) => l.trim())?.trim().slice(0, 300);
  if (!line) return undefined;
  return { hash: ex.hash, ts: ex.ts, session: ex.session, line };
}

type Cache = Record<string, Judgment>;

function loadCache(): Cache {
  if (!existsSync(CACHE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  } catch {
    return {}; // a corrupt cache costs re-reads, never a crash
  }
}

function saveCache(c: Cache): void {
  mkdirSync(STRATLESS, { recursive: true });
  writeFileSync(CACHE, `${JSON.stringify(c)}\n`);
}

export interface JudgeRun {
  /** every judgment for the given exchanges, in corpus order — cached and fresh together */
  judgments: Judgment[];
  /** how many exchanges we spent a claude call on this run */
  fresh: number;
  /** how many came free from cache */
  cached: number;
  /** exchanges still unjudged because a per-run limit was hit — 0 unless `limit` was set */
  deferred: number;
}

/**
 * Judge every exchange, reading each only once ever.
 *
 * `limit` caps how many FRESH claude calls this run makes (cache hits are always free and never
 * counted). It exists so the first backlog run — or a demo — can't quietly spend hundreds of calls
 * in one go; the rest simply wait for the next run. `onProgress(done, total)` fires per fresh judgment.
 */
export function judgeAll(
  exchanges: Exchange[],
  bin: string,
  opts: { limit?: number; onProgress?: (done: number, total: number) => void } = {},
): JudgeRun {
  const cache = loadCache();
  const judgments: Judgment[] = [];
  const unjudged = exchanges.filter((e) => !cache[e.hash]);
  const budget = opts.limit ?? unjudged.length;
  const target = Math.min(budget, unjudged.length);

  let fresh = 0;
  let cached = 0;
  let spent = 0;

  for (const ex of exchanges) {
    const hit = cache[ex.hash];
    if (hit) {
      judgments.push(hit);
      cached++;
      continue;
    }
    if (spent >= budget) continue; // over this run's limit — leave it uncached for next time
    spent++;
    const j = judge(ex, bin);
    if (j) {
      cache[ex.hash] = j;
      judgments.push(j);
      fresh++;
      if (fresh % 10 === 0) saveCache(cache); // checkpoint so a crash never re-spends what it read
      opts.onProgress?.(fresh, target);
    }
  }

  saveCache(cache);
  return { judgments, fresh, cached, deferred: unjudged.length - spent };
}
