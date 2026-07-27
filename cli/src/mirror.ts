/**
 * THE FREE MIRROR — everything stratless can see about a person for nothing.
 *
 * No model calls, no network, no spend. It reads what is already on their disk and computes. This
 * is what a stranger is shown BEFORE deciding whether to pay for the deep read, which sets the bar:
 *
 *   ONE number the user knows is wrong destroys every other number on the page.
 *
 * So the rules here are stricter than "is it interesting":
 *   · every metric states what ONE unit is, in one sentence, or it does not exist;
 *   · every metric must be checkable against the person's own memory;
 *   · count EVENTS, never rows — "5,238 subagent runs" was really 5,238 lines mentioning agents;
 *   · no metric whose result depends on a parameter we chose. A run-length-by-hour statistic
 *     manufactured a two-peak "deep work" finding that ranked #1 at a 30-minute gap threshold and
 *     #3/#6/#8 at 10/15/45. It measured the parameter, not the person.
 *
 * Everything reads from reader.ts, which already decided what counts as the person talking. Nothing
 * here re-derives that: seven passes that each decided for themselves produced seven different
 * message counts spanning 44%.
 *
 * This module computes. It does not print — the display layer is a separate concern.
 */
import { readTurns, readTitles, isTypedMessage, dayKey, type Turn } from './reader.js';

/** A friction event, kept whole so any count here can be dereferenced back to the moment. */
export interface FrictionEvent {
  uuid: string;
  ts: string;
  kind: 'course-correction' | 'tool-decline' | 'system-block' | 'permission-stop';
}

export interface Mirror {
  scale: {
    /** one unit: one message the person submitted */
    messages: number;
    /** one unit: one calendar day (04:00 boundary) carrying at least one submitted message */
    activeDays: number;
    /** calendar days from first submitted message to last */
    spanDays: number;
    /** median submitted messages across active days — the mean is dragged by one 400-message day */
    medianPerActiveDay: number;
    /** longest run of consecutive active days */
    longestStreak: number;
    firstMessage: string;
    lastMessage: string;
  };
  writing: {
    /** words per message, pastes excluded — an uncapped p95 read 1,024 words, the capped one 78 */
    median: number;
    p25: number;
    p75: number;
    p90: number;
    /** share of messages that are four words or fewer */
    terseShare: number;
    /** share whose final character is '?' */
    questionShare: number;
    /** one unit: one submitted message over the paste bound */
    pastes: number;
    /** one unit: one image carried by a submitted message */
    images: number;
    /** the person's most-repeated messages — one unit: one submitted, non-pasted message whose
     *  entire trimmed text is exactly this. "Repeated" means count ≥ 2 by definition, not a tuned
     *  threshold; top 8 kept, ties broken by text so the list is stable across runs. THE ONE
     *  TEXT-CARRYING FIELD in the Mirror: it exists for the person's own terminal, and the share
     *  card must never draw it (renderCard states the rule). */
    repeated: { text: string; count: number }[];
  };
  friction: {
    /** one unit: one Escape pressed mid-generation. NOT the same event as a tool decline. */
    courseCorrections: number;
    /** one unit: one tool the PERSON declined */
    toolDeclines: number;
    /** the permission-flow interrupt: generation stopping BECAUSE a tool was declined. Reported
     *  separately and excluded from the rate — 39% pair with a decline already counted, and the
     *  rest signal the same thing (a tool did not run). Shown, never silently dropped. */
    permissionStops: number;
    /** one unit: one tool the SYSTEM blocked — not the person, never counted as their friction */
    systemBlocks: number;
    /** course corrections + tool declines, per 100 submitted messages */
    perHundred: number;
    daysWithAny: number;
    events: FrictionEvent[];
  };
  context: {
    /** one unit: one repository root — subdirectories collapse into the root they sit under */
    repos: { root: string; messages: number }[];
    /** one unit: one (repo, branch) pair — `main` in four repos is four, not one */
    branchPairs: number;
    branchNames: number;
  };
  work: {
    /** one unit: one tool_use block in an assistant reply */
    toolMix: { name: string; calls: number; share: number }[];
    toolCalls: number;
  };
  rhythm: {
    /** submitted messages per clock hour, local time, 24 bins */
    byHour: number[];
    /** how many distinct hours are needed to cover 80% / 90% of messages. No threshold to tune:
     *  a fixed population in fixed bins. Replaces the killed "peak hour", whose winner moved
     *  between halves of the same archive. */
    hoursFor80: number;
    hoursFor90: number;
  };
  /** one unit: one distinct session title written by the harness, our own sessions removed */
  topics: string[];
}

const median = (xs: number[]): number => quantile(xs, 0.5);

function quantile(xs: number[], f: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * f))];
}

/** Words in a message. Whitespace-split is enough — the order statistics are tail-proof once
 *  pastes are excluded, and a cleverer tokenizer would only move the number without checking. */
const words = (s: string): number => (s.trim() ? s.trim().split(/\s+/).length : 0);

/**
 * Collapse working directories to repository roots.
 *
 * 49 distinct `cwd` values on this archive are really 5 repos — 24 of them are subdirectories of
 * another counted directory, and 20 more never received a typed message at all. A person knows how
 * many repos they have; they cannot check a cwd count, so the cwd count must not be shown.
 */
export function repoRoots(cwds: Iterable<string>): Map<string, string> {
  const all = [...new Set(cwds)].sort((a, b) => a.length - b.length);
  const rootOf = new Map<string, string>();
  for (const dir of all) {
    const parent = all.find((c) => c !== dir && (dir === c || dir.startsWith(c.endsWith('/') ? c : `${c}/`)));
    rootOf.set(dir, parent ? (rootOf.get(parent) ?? parent) : dir);
  }
  return rootOf;
}

/** How many distinct hours hold `frac` of the messages? Sort the bins, accumulate, count. */
function hoursToCover(byHour: number[], frac: number): number {
  const total = byHour.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  let acc = 0;
  let n = 0;
  for (const c of [...byHour].sort((a, b) => b - a)) {
    if (acc >= total * frac) break;
    acc += c;
    n++;
  }
  return n;
}

function longestStreak(days: string[]): number {
  if (!days.length) return 0;
  const sorted = [...new Set(days)].sort();
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const gap = (Date.parse(sorted[i]) - Date.parse(sorted[i - 1])) / 86_400_000;
    run = gap === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/** Titles the harness wrote for OUR OWN borrowed sessions ("Confirm acknowledgment") are not
 *  topics the person worked on. ai-title records carry no entrypoint, so they are joined on
 *  sessionId against the sessions the reader accepted. */
export function personTopics(titles: { aiTitle: string; sessionId: string }[], personSessions: Set<string>): string[] {
  const out = new Set<string>();
  for (const t of titles) if (personSessions.has(t.sessionId) && t.aiTitle?.trim()) out.add(t.aiTitle.trim());
  return [...out];
}

/** Compute the whole mirror from a stream of clean turns. Single pass; nothing accumulates except
 *  the per-metric tallies and the friction receipts. */
export function mirrorOf(turns: Iterable<Turn>, titles: { aiTitle: string; sessionId: string }[] = []): Mirror {
  const lens: number[] = [];
  const exactCounts = new Map<string, number>();
  const byHour = new Array(24).fill(0) as number[];
  const dayCounts = new Map<string, number>();
  const frictionDays = new Set<string>();
  const cwdCounts = new Map<string, number>();
  /** (cwd, branch) as seen; resolved to repo roots after the walk, since keying pairs on cwd
   *  multiplies them by however many subdirectories were worked in. */
  const rawPairs: [string, string][] = [];
  const branchNames = new Set<string>();
  const tools = new Map<string, number>();
  const events: FrictionEvent[] = [];
  const sessions = new Set<string>();

  let messages = 0;
  let terse = 0;
  let questions = 0;
  let pastes = 0;
  let images = 0;
  let courseCorrections = 0;
  let permissionStops = 0;
  let toolDeclines = 0;
  let systemBlocks = 0;
  let first = '';
  let last = '';

  for (const t of turns) {
    if (t.session) sessions.add(t.session);

    if (t.role === 'assistant') {
      for (const name of t.tools ?? []) tools.set(name, (tools.get(name) ?? 0) + 1);
      continue;
    }

    const day = t.ts ? dayKey(t.ts) : '';

    // Control actions first: an interrupt or a denial is an event, never a message. The two
    // interrupt forms are DIFFERENT events (measured: 1% vs 39% coincidence with a decline), so
    // only the spontaneous one counts toward the rate.
    if (t.interrupted) {
      if (t.interruptKind === 'tool-use') {
        permissionStops++;
        events.push({ uuid: t.uuid, ts: t.ts, kind: 'permission-stop' });
      } else {
        courseCorrections++;
        events.push({ uuid: t.uuid, ts: t.ts, kind: 'course-correction' });
        if (day) frictionDays.add(day);
      }
    }
    if (t.denial === 'user-rejected') {
      toolDeclines++;
      events.push({ uuid: t.uuid, ts: t.ts, kind: 'tool-decline' });
      if (day) frictionDays.add(day);
    } else if (t.denial === 'automode-blocked') {
      systemBlocks++;
      events.push({ uuid: t.uuid, ts: t.ts, kind: 'system-block' });
    }

    images += t.images;
    if (!isTypedMessage(t)) continue;

    messages++;
    if (t.ts) {
      if (!first || t.ts < first) first = t.ts;
      if (!last || t.ts > last) last = t.ts;
      byHour[new Date(t.ts).getHours()]++;
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    }
    if (t.cwd) cwdCounts.set(t.cwd, (cwdCounts.get(t.cwd) ?? 0) + 1);
    // A detached HEAD is a state, not a branch.
    if (t.gitBranch && t.gitBranch !== 'HEAD') {
      branchNames.add(t.gitBranch);
      rawPairs.push([t.cwd ?? '', t.gitBranch]);
    }

    if (t.pasted) {
      pastes++;
    } else {
      const trimmed = t.text.trim();
      if (trimmed) exactCounts.set(trimmed, (exactCounts.get(trimmed) ?? 0) + 1);
      const w = words(t.text);
      lens.push(w);
      if (w <= 4) terse++;
    }
    if (/\?$/.test(t.text.trim())) questions++;
  }

  const rootOf = repoRoots(cwdCounts.keys());
  const repoCounts = new Map<string, number>();
  for (const [dir, n] of cwdCounts) {
    const root = rootOf.get(dir) ?? dir;
    repoCounts.set(root, (repoCounts.get(root) ?? 0) + n);
  }

  // Resolve branch pairs to repo ROOTS. Keyed on cwd they multiply by every subdirectory worked
  // in — 77 pairs across 5 repos, which is a count of directories wearing a branch label.
  const branchPairs = new Set<string>();
  for (const [dir, branch] of rawPairs) branchPairs.add((rootOf.get(dir) ?? dir) + ' ' + branch);

  const totalToolCalls = [...tools.values()].reduce((a, b) => a + b, 0);
  const spanDays = first && last ? Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000) + 1 : 0;

  return {
    scale: {
      messages,
      activeDays: dayCounts.size,
      spanDays,
      medianPerActiveDay: median([...dayCounts.values()]),
      longestStreak: longestStreak([...dayCounts.keys()]),
      firstMessage: first,
      lastMessage: last,
    },
    writing: {
      median: median(lens),
      p25: quantile(lens, 0.25),
      p75: quantile(lens, 0.75),
      p90: quantile(lens, 0.9),
      terseShare: lens.length ? terse / lens.length : 0,
      questionShare: messages ? questions / messages : 0,
      pastes,
      images,
      repeated: [...exactCounts.entries()]
        .filter(([, c]) => c >= 2)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([text, count]) => ({ text, count })),
    },
    friction: {
      courseCorrections,
      toolDeclines,
      permissionStops,
      systemBlocks,
      perHundred: messages ? (100 * (courseCorrections + toolDeclines)) / messages : 0,
      daysWithAny: frictionDays.size,
      events,
    },
    context: {
      repos: [...repoCounts.entries()]
        .map(([root, n]) => ({ root, messages: n }))
        .sort((a, b) => b.messages - a.messages),
      branchPairs: branchPairs.size,
      branchNames: branchNames.size,
    },
    work: {
      toolMix: [...tools.entries()]
        .map(([name, calls]) => ({ name, calls, share: totalToolCalls ? calls / totalToolCalls : 0 }))
        .sort((a, b) => b.calls - a.calls),
      toolCalls: totalToolCalls,
    },
    rhythm: {
      byHour,
      hoursFor80: hoursToCover(byHour, 0.8),
      hoursFor90: hoursToCover(byHour, 0.9),
    },
    topics: personTopics(titles, sessions),
  };
}

/** Read an archive directory and compute its mirror. Titles are a second, lighter pass — they live
 *  in a record type readTurns drops, and can only be filtered by joining on the sessions it kept. */
export function mirrorOfArchive(dir: string): Mirror {
  return mirrorOf(readTurns([dir]), readTitles(dir));
}

/**
 * Async twin of {@link mirrorOfArchive}. Same result, but it drains the transcript walk in chunks and
 * yields to the event loop between them — so a caller can animate a spinner during the read. The sync
 * twin blocks the loop end to end (a spinner would freeze on one frame); this one lets it breathe. The
 * heavy cost is the I/O + parse the generator does as it advances, so yielding every N turns is enough.
 */
export async function mirrorOfArchiveAsync(dir: string): Promise<Mirror> {
  const turns: Turn[] = [];
  let i = 0;
  for (const t of readTurns([dir])) {
    turns.push(t);
    if ((++i & 63) === 0) await new Promise((r) => setImmediate(r)); // yield so the spinner can tick
  }
  return mirrorOf(turns, readTitles(dir));
}
