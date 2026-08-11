/**
 * MEASURE — the five questions the record answers, with receipts (the tune, step 1).
 *
 * The product is three verbs: measure, report, install. This file is the first verb. It asks
 * the record five questions, each with a deterministic detector, and returns findings that
 * carry stable IDs, code-stamped receipts, and real moments as proof:
 *
 *   RITUAL   — what does this pair do again and again?    (command chains from what the AI RAN —
 *              measured 2026-08-10: the ritual signal lives below the exchange seam, in the raw
 *              transcripts' Bash inputs; prompts alone found nothing)
 *   LESSON   — what went wrong and cost them?             (friction episodes: interrupts/declines
 *              chained within a session)
 *   RULE     — what do they keep demanding?               (short imperatives recurring across
 *              sessions — "merged watch the ci", 9×/6)
 *   WIN      — what worked?                               (fast approvals right after the AI acts)
 *   ARRIVAL  — what is newly entering their work?         (terms first seen recently, with spread)
 *
 * Two angles were tested and CUT on evidence (2026-08-10): reminders (empty under two
 * detectors) and knowledge (its shipped readout returns empty; Sun's call). They are not
 * deferred; re-entry only by new evidence.
 *
 * Determinism: every detector is arithmetic over the corpus; same record, same findings,
 * byte for byte. IDs are pure functions of a finding's identity content — counts and new
 * moments refresh under an unmoved ID. Claims are code templates, digit-stripped; every
 * numeral lives in receipts. The model never decides existence here — it only writes, later,
 * citing these IDs.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { records } from '../integrations/assistants/registry.js';
import { iterateExchangesNewestFirst } from '../pipeline/exchange.js';
import type { Exchange } from '../pipeline/exchange.js';

export type AngleKind = 'ritual' | 'lesson' | 'rule' | 'win' | 'arrival';

/** The embedding pass the inspection rides — the shipped local model, injectable in tests. */
export type Embedder = (texts: string[]) => Promise<Float32Array[]>;

export interface Finding {
  /** kind:record:sha16(identity) — stable while the identity content is stable */
  id: string;
  kind: AngleKind;
  /** one sentence, code-templated, digit-stripped — numerals live in receipts only */
  claim: string;
  receipts: Record<string, number>;
  /** up to three real moments; hash present where the exchange layer carries one */
  exemplars: { session: string; hash?: string; ts?: string; quote?: string }[];
  /** raw identity content (tokens, phrases, terms) for the guide to read — digits allowed */
  detail?: Record<string, string | string[]>;
}

const sha16 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);
const stripDigits = (s: string): string => s.replace(/[0-9]+/g, '').replace(/\s+/g, ' ').trim();
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 '/.-]/g, ' ').replace(/\s+/g, ' ').trim();

const STOP = new Set(
  "the a an and or but of to in on for with is are was were be been it this that i you we they he she my your our its at as by from not no yes do does did have has had will would can could should just so then than when what how why where which there here also very really".split(' '),
);
const FILLER = new Set(['ok', 'okay', 'now', 'then', 'and', 'yes', 'also', 'next', 'lets', 'go', 'please', 'sure', 'wait']);

/** Named dials — floors measured against the reference archive (2026-08-10 probes), the
 *  LIFT_CUT comment discipline: product decisions, not statistics pretending otherwise. */
export const RITUAL_MIN_COUNT = 4;
export const RITUAL_MIN_SESSIONS = 3;
export const LESSON_WINDOW = 6;
export const RULE_MIN_COUNT = 3;
export const RULE_MIN_SESSIONS = 3;
export const ARRIVAL_MIN_COUNT = 15;
export const ARRIVAL_MIN_SPREAD = 5;
export const ARRIVAL_WINDOW_DAYS = 30;
const TOP = { ritual: 8, lesson: 8, rule: 10, win: 1, arrival: 8 } as const;

/* ── the corpus, prepared once ─────────────────────────────────────────────────────────── */

/** Per-session exchange lists, oldest-first — the shape every exchange-level detector reads. */
export function sessionsOf(exchanges: Iterable<Exchange>, record: string): Map<string, Exchange[]> {
  const sessions = new Map<string, Exchange[]>();
  for (const ex of exchanges) {
    if (ex.record !== record) continue;
    if (!sessions.has(ex.session)) sessions.set(ex.session, []);
    sessions.get(ex.session)!.push(ex);
  }
  for (const list of sessions.values()) list.reverse();
  return sessions;
}

/** Command-verb chains per raw session file — the ritual signal lives in what the AI ran,
 *  which the exchange seam strips (tool names only), so this reads the transcripts directly.
 *  Read-only; a malformed line is skipped; a file that vanishes contributes nothing. */
export async function commandChains(roots: string[]): Promise<Map<string, string[]>> {
  const files: string[] = [];
  for (const r of roots) {
    if (!existsSync(r)) continue;
    let entries;
    try {
      entries = readdirSync(r, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) files.push(join(r, e.name));
      else if (e.isDirectory()) {
        try {
          for (const f of readdirSync(join(r, e.name))) if (f.endsWith('.jsonl')) files.push(join(r, e.name, f));
        } catch {
          /* unreadable dir — skip */
        }
      }
    }
  }
  const verbOf = (cmd: string): string | null => {
    const m = cmd.trim().match(/^(git|pnpm|npm|gh|node|npx|python3?|corepack|curl|mkdir|cp|mv|sed|grep|find|ls|cat|stratless)\s+(\S+)?/);
    if (!m) return null;
    const sub = (m[2] ?? '').replace(/^-.*/, '').slice(0, 12);
    return sub ? `${m[1]} ${sub}` : m[1]!;
  };
  const chains = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const file of files) {
    const key = file.split('/').pop()!;
    if (seen.has(key)) continue; // live + archive hold the same session under one filename
    seen.add(key);
    const chain: string[] = [];
    try {
      const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
      await new Promise<void>((resolve) => {
        rl.on('line', (line) => {
          if (!line.includes('"Bash"')) return;
          try {
            const j = JSON.parse(line) as { message?: { content?: unknown } };
            const content = j?.message?.content;
            if (!Array.isArray(content)) return;
            for (const c of content as { type?: string; name?: string; input?: { command?: string } }[]) {
              if (c?.type !== 'tool_use' || c?.name !== 'Bash' || typeof c?.input?.command !== 'string') continue;
              for (const part of c.input.command.split(/&&|;|\n/)) {
                const v = verbOf(part);
                if (v && chain[chain.length - 1] !== v) chain.push(v);
              }
            }
          } catch {
            /* torn line — skip */
          }
        });
        rl.on('close', resolve);
      });
    } catch {
      continue;
    }
    if (chain.length) chains.set(key, chain);
  }
  return chains;
}

/* ── the five detectors — pure over prepared inputs, individually testable ─────────────── */

export function findRituals(chains: Map<string, string[]>, record: string): Finding[] {
  const grams = new Map<string, { count: number; sessions: Set<string> }>();
  for (const [sid, chain] of chains)
    for (let n = 3; n <= 5; n++)
      for (let i = 0; i + n <= chain.length; i++) {
        const g = chain.slice(i, i + n).join(' → ');
        if (!grams.has(g)) grams.set(g, { count: 0, sessions: new Set() });
        const e = grams.get(g)!;
        e.count++;
        e.sessions.add(sid);
      }
  const kept = [...grams.entries()]
    .filter(([, v]) => v.count >= RITUAL_MIN_COUNT && v.sessions.size >= RITUAL_MIN_SESSIONS)
    .sort((a, b) => b[1].count * a[0].length - a[1].count * b[0].length || a[0].localeCompare(b[0]));
  // closed-ish: drop a gram contained in a kept longer gram with the same support
  const survivors = kept.filter(([g, v], i) => !kept.some(([g2, v2], j) => j < i && g2.includes(g) && v2.count === v.count));
  return survivors.slice(0, TOP.ritual).map(([g, v]) => ({
    id: `ritual:${record}:${sha16(g)}`,
    kind: 'ritual' as const,
    claim: `they run this chain again and again: ${stripDigits(g)}`,
    receipts: { occurrences: v.count, sessions: v.sessions.size },
    exemplars: [...v.sessions].sort().slice(0, 3).map((session) => ({ session })),
    detail: { tokens: g.split(' → ') },
  }));
}

export function findLessons(sessions: Map<string, Exchange[]>, record: string): Finding[] {
  interface Episode { session: string; first: number; last: number; seeds: Exchange[] }
  const episodes: Episode[] = [];
  for (const [session, list] of sessions) {
    let cur: Episode | undefined;
    list.forEach((ex, i) => {
      if (!(ex.interrupted === 'plain' || ex.declined)) return;
      if (cur && i - cur.last <= LESSON_WINDOW) {
        cur.last = i;
        cur.seeds.push(ex);
      } else {
        if (cur) episodes.push(cur);
        cur = { session, first: i, last: i, seeds: [ex] };
      }
    });
    if (cur) episodes.push(cur);
  }
  return episodes
    .map((e) => ({ ...e, arc: e.last - e.first + 1 }))
    .filter((e) => e.arc >= 4 || e.seeds.length >= 2)
    .sort((a, b) => b.arc * b.seeds.length - a.arc * a.seeds.length || a.seeds[0]!.hash.localeCompare(b.seeds[0]!.hash))
    .slice(0, TOP.lesson)
    .map((e) => ({
      id: `lesson:${record}:${e.seeds[0]!.hash}`,
      kind: 'lesson' as const,
      claim: 'a stretch of work where they kept having to stop and redirect the assistant',
      receipts: { corrections: e.seeds.length, exchanges: e.arc },
      exemplars: e.seeds.slice(0, 3).map((s) => ({ session: s.session, hash: s.hash, ts: s.ts, quote: norm(s.reaction).slice(0, 90) })),
    }));
}

export function findRules(sessions: Map<string, Exchange[]>, record: string): Finding[] {
  const phrases = new Map<string, { count: number; sessions: Set<string>; ex: { session: string; hash: string }[] }>();
  for (const [session, list] of sessions)
    for (const ex of list) {
      const p = norm(ex.prompt);
      const w = p.split(' ').filter(Boolean);
      if (!p || ex.pasted || w.length < 2 || w.length > 12 || p.includes('?')) continue;
      if (w.every((x) => STOP.has(x) || FILLER.has(x))) continue;
      if (!phrases.has(p)) phrases.set(p, { count: 0, sessions: new Set(), ex: [] });
      const e = phrases.get(p)!;
      e.count++;
      e.sessions.add(session);
      if (e.ex.length < 3) e.ex.push({ session, hash: ex.hash });
    }
  return [...phrases.entries()]
    .filter(([, v]) => v.count >= RULE_MIN_COUNT && v.sessions.size >= RULE_MIN_SESSIONS)
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, TOP.rule)
    .map(([p, v]) => ({
      id: `rule:${record}:${sha16(p)}`,
      kind: 'rule' as const,
      claim: `they keep saying it, session after session: "${stripDigits(p)}"`,
      receipts: { count: v.count, sessions: v.sessions.size },
      exemplars: v.ex,
      detail: { phrase: p },
    }));
}

const WIN = /^(ok good|good good|exactly|perfect|nice|beautiful|love it|this is good|yes exactly|great|ok great|clear)\b/;

export function findWins(sessions: Map<string, Exchange[]>, record: string): Finding[] {
  let count = 0;
  const exemplars: Finding['exemplars'] = [];
  const approved: string[] = [];
  for (const [session, list] of sessions)
    list.forEach((ex, i) => {
      const p = norm(ex.prompt);
      if (!p || p.length > 60 || !WIN.test(p)) return;
      count++;
      if (exemplars.length < 3 && i > 0) {
        exemplars.push({ session, hash: ex.hash, ts: ex.ts, quote: p.slice(0, 60) });
        approved.push(norm(list[i - 1]!.said || '').slice(0, 80));
      }
    });
  if (count === 0) return [];
  return [
    {
      id: `win:${record}:approvals`,
      kind: 'win',
      claim: 'moments they approved fast — what preceded these is what to do more of',
      receipts: { approvals: count },
      exemplars,
      detail: { approvedAfter: approved },
    },
  ];
}

export function findArrivals(sessions: Map<string, Exchange[]>, record: string): Finding[] {
  const firstSeen = new Map<string, string>();
  const counts = new Map<string, number>();
  const spread = new Map<string, Set<string>>();
  const all = [...sessions.values()].flat().sort((a, b) => a.ts.localeCompare(b.ts));
  if (!all.length) return [];
  for (const ex of all)
    for (const w of new Set(norm(ex.prompt).split(' ').filter((x) => x.length >= 4 && !STOP.has(x) && !FILLER.has(x)))) {
      if (!firstSeen.has(w)) firstSeen.set(w, ex.ts);
      counts.set(w, (counts.get(w) ?? 0) + 1);
      if (!spread.has(w)) spread.set(w, new Set());
      spread.get(w)!.add(ex.session);
    }
  // deterministic window: anchored to the corpus's own newest moment, never the wall clock
  const newest = all[all.length - 1]!.ts;
  const cutoff = new Date(new Date(newest).getTime() - ARRIVAL_WINDOW_DAYS * 86_400_000).toISOString();
  return [...firstSeen.entries()]
    .filter(([w, ts]) => ts >= cutoff && (counts.get(w) ?? 0) >= ARRIVAL_MIN_COUNT && (spread.get(w)?.size ?? 0) >= ARRIVAL_MIN_SPREAD)
    .sort((a, b) => counts.get(b[0])! - counts.get(a[0])! || a[0].localeCompare(b[0]))
    .slice(0, TOP.arrival)
    .map(([w, ts]) => ({
      id: `arrival:${record}:${sha16(w)}`,
      kind: 'arrival' as const,
      claim: `something new has entered their work: "${stripDigits(w)}"`,
      receipts: { count: counts.get(w)!, sessions: spread.get(w)!.size },
      exemplars: [{ session: [...spread.get(w)!].sort()[0]!, ts }],
      detail: { term: w, firstSeen: ts },
    }));
}

/* ── measure — the one entry point ─────────────────────────────────────────────────────── */

export interface MeasureInputs {
  exchanges?: Iterable<Exchange>;
  chains?: Map<string, string[]>;
}

/** Ask the record the five questions. Injectable inputs keep tests hermetic; production reads
 *  the live walks. Same corpus in, same findings out. */
export async function measure(record: string, inputs: MeasureInputs = {}): Promise<Finding[]> {
  // The archive walk is lazy: each step of this loop is what actually reads the files. Consuming
  // it in one synchronous sweep starves the event loop for seconds — the door's spinner sits
  // frozen on its first frame — so yield every few hundred exchanges to let timers fire.
  const exchanges: Exchange[] = [];
  let walked = 0;
  for (const ex of inputs.exchanges ?? iterateExchangesNewestFirst()) {
    exchanges.push(ex);
    if (++walked % 500 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const sessions = sessionsOf(exchanges, record);
  const chains =
    inputs.chains ??
    (await commandChains(records().find((r) => r.id === record)?.roots() ?? []));
  return [
    ...findRituals(chains, record),
    ...findLessons(sessions, record),
    ...findRules(sessions, record),
    ...findWins(sessions, record),
    ...findArrivals(sessions, record),
  ];
}
