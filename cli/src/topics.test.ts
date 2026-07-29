/**
 * TOPICS — the knowledge read's guarantees, pinned. The ones that matter most: the ask detector is
 * DERIVED from the corpus in front of it (an invented ritual on a synthetic corpus must qualify; a
 * corpus without the pattern must yield none — zero is legal), and the bright zones can never mint
 * (strong and delegated are structurally outside the thread bar).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { adjacencyOf, type Labelled } from './count.js';
import type { Moment } from './moments.js';
import { askRituals, topicsRead, topicWindowRead, topicSpanRead, discriminate, type TopicThread } from './topics.js';

/** The walk stand-in for card-only fixtures: synthetic answers are short, so the card's candidate
 *  terms ARE the full text — df over them is honestly the full-text df. */
const fullOf = (labelled: Labelled[]): { df: Map<string, number>; answers: number } => {
  const df = new Map<string, number>();
  let answers = 0;
  for (const l of labelled) {
    if (!l.moment.aiTerms?.length) continue;
    answers++;
    for (const t of new Set(l.moment.aiTerms)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return { df, answers };
};

// ── fixture builders ────────────────────────────────────────────────────────────────────────────

let k = 0;
const mo = (
  session: string,
  ts: string,
  reply: string,
  o: { aiTerms?: string[]; saidLen?: number; calls?: number } = {},
): Labelled => ({
  moment: {
    key: `k${k++}`,
    session,
    ts,
    pile: 'ordinary',
    reply,
    replyLen: reply.length,
    ...(o.aiTerms ? { aiTerms: o.aiTerms } : {}),
    ...(o.saidLen !== undefined ? { saidLen: o.saidLen } : {}),
    ...(o.calls !== undefined ? { calls: o.calls } : {}),
  } as Moment,
  kinds: [],
});

/**
 * A synthetic archive with one planted topic. Four sessions across eleven days; in each, the person
 * repeatedly asks with the invented ritual "how come …" and the assistant answers with a long prose
 * explanation naming `caching`/`details`. Around them: filler work (short assistant turns, so the
 * base explanation rate stays low), a `wrangler` zone the person TYPES without asking, a `css-grid`
 * zone the assistant mentions and the person never touches, and `workbench` everywhere (background
 * vocabulary the rare band must exclude).
 */
function corpus(): Labelled[] {
  k = 0;
  const out: Labelled[] = [];
  const days = ['2026-07-01', '2026-07-04', '2026-07-09', '2026-07-12'];
  for (let s = 0; s < 4; s++) {
    const sess = `s${s + 1}`;
    let sec = 0;
    const at = () => `${days[s]}T10:${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec++ % 60).padStart(2, '0')}Z`;
    const filler = (reply = 'do the tests please', terms: string[] = ['workbench']) =>
      out.push(mo(sess, at(), reply, { aiTerms: terms, saidLen: 50 }));

    filler();
    if (s < 2) filler('the wrangler setup is fine today', ['workbench', 'wrangler']);
    if (s < 3) filler('do the tests please', ['workbench', 'css-grid']);
    for (let a = 0; a < 3; a++) {
      // the ask: the AI's pre-ask turn is short background chatter; the person asks
      out.push(mo(sess, at(), 'how come it works', { aiTerms: ['workbench'], saidLen: 100 }));
      // the answer: a long prose explanation naming the topic; the person moves on
      out.push(mo(sess, at(), 'ok fine', { aiTerms: ['caching', 'details'], saidLen: 2000, calls: 0 }));
      filler();
    }
    if (s < 2) filler('the wrangler setup is fine today', ['workbench', 'wrangler']);
    filler();
  }
  // the one bounce, in s1: ask → explanation that comes back as another ask, immediately
  const sess = 's1';
  out.push(mo(sess, '2026-07-01T11:00:00Z', 'how come it works', { aiTerms: ['workbench'], saidLen: 100 }));
  out.push(mo(sess, '2026-07-01T11:00:01Z', 'how come it fails', { aiTerms: ['caching', 'details'], saidLen: 2000 }));
  out.push(mo(sess, '2026-07-01T11:00:02Z', 'ok', { aiTerms: ['caching', 'details'], saidLen: 2000 }));
  return out;
}

// ── the detector ────────────────────────────────────────────────────────────────────────────────

test('the ask ritual is DERIVED from the corpus — the invented phrase qualifies, the work phrase does not', () => {
  const c = corpus();
  const rituals = askRituals(c, adjacencyOf(c));
  assert.ok([...rituals].some((p) => p.startsWith('how come')), 'the planted ritual was mined from adjacency alone');
  assert.ok(![...rituals].some((p) => p.startsWith('do the')), 'the work phrase is answered with work, not explanations');
});

test('a corpus without the ask pattern yields no rituals and no threads — zero is legal', () => {
  k = 0;
  const flat: Labelled[] = [];
  for (let i = 0; i < 20; i++)
    flat.push(mo(`s${i % 4}`, `2026-07-0${1 + (i % 4)}T10:00:${String(i).padStart(2, '0')}Z`, 'do the tests please', { aiTerms: ['workbench'], saidLen: 50 }));
  const read = topicsRead(flat, undefined, fullOf(flat));
  assert.ok(read, 'the pile carries the topic channel, so the read runs');
  assert.deepEqual(read!.rituals, [], 'no phrase earned ritual status');
  assert.deepEqual(read!.threads, [], 'and nothing threads — the honest empty answer');
});

test('refuse, don\'t lie — a pile with no topic channel anywhere reads as undefined, not as "no topics"', () => {
  k = 0;
  const old: Labelled[] = [mo('s1', '2026-07-01T10:00:00Z', 'how come it works'), mo('s1', '2026-07-01T10:00:01Z', 'ok')];
  assert.equal(topicsRead(old), undefined, 'a pre-v3 pile must not claim the person has no topics');
  const v3 = [mo('s1', '2026-07-01T10:00:02Z', 'ok', { aiTerms: ['caching'], saidLen: 900 })];
  assert.equal(topicsRead(v3, undefined, { df: new Map(), answers: 0 }), undefined, 'and a walk that found nothing refuses too — rarity may not be judged on a falsified basis');
});

// ── threading ───────────────────────────────────────────────────────────────────────────────────

test('the planted topic threads, aliases fold to one thread, and the bounce is counted and attributed', () => {
  const c0 = corpus();
  const read = topicsRead(c0, undefined, fullOf(c0))!;
  assert.equal(read.threads.length, 1, 'caching and details answer the same asks — one thread, not two');
  const t = read.threads[0];
  assert.deepEqual(t.terms.slice(0, 2), ['caching', 'details'], 'the thread names itself from the answers');
  assert.equal(t.askCount, 14, 'twelve planted asks, the bounce block\'s opener, and its immediate re-ask');
  assert.equal(t.askSessions, 4);
  assert.ok(t.spanDays >= 7, 'the span clears the locked bar');
  assert.equal(t.bounces, 1, 'the one explanation that came straight back, attributed by its own terms');
  assert.ok(t.answerKeys.length > 0, 'the answering turns are addressable for the discriminator');
});

test('below the bar nothing threads — three asks are a curiosity, not a topic', () => {
  k = 0;
  const c: Labelled[] = [];
  for (let s = 0; s < 3; s++) {
    const sess = `s${s + 1}`;
    const day = ['2026-07-01', '2026-07-04', '2026-07-09'][s];
    // enough non-explanation pairs that the base rate stays low and the ritual can qualify
    for (let i = 0; i < 4; i++) c.push(mo(sess, `${day}T10:00:${String(i).padStart(2, '0')}Z`, 'do the tests please', { aiTerms: ['workbench'], saidLen: 50 }));
    c.push(mo(sess, `${day}T10:01:00Z`, 'how come it works', { aiTerms: ['workbench'], saidLen: 100 }));
    c.push(mo(sess, `${day}T10:01:01Z`, 'ok fine', { aiTerms: ['caching'], saidLen: 2000 }));
    for (let i = 0; i < 4; i++) c.push(mo(sess, `${day}T10:02:${String(i).padStart(2, '0')}Z`, 'how come it works', { aiTerms: ['workbench'], saidLen: 100 }));
    for (let i = 0; i < 4; i++) c.push(mo(sess, `${day}T10:03:${String(i).padStart(2, '0')}Z`, 'ok done', { aiTerms: ['workbench'], saidLen: 50 }));
  }
  const read = topicsRead(c, undefined, fullOf(c))!;
  // `caching` reaches only 3 ask events (one per session) — under THREAD_ASK_MIN
  assert.deepEqual(read.threads, [], 'the locked bar holds');
});

// ── the bright zones ────────────────────────────────────────────────────────────────────────────

test('strong and delegated are mapped, and background vocabulary is neither', () => {
  const c0 = corpus();
  const read = topicsRead(c0, undefined, fullOf(c0))!;
  assert.ok(read.strong.includes('wrangler'), 'typed in their own replies without asking — strength');
  assert.ok(read.delegated.includes('css-grid'), 'the assistant keeps saying it, the person never enters — delegation');
  assert.ok(!read.strong.includes('workbench') && !read.delegated.includes('workbench'), 'background vocabulary is outside the rare band');
  assert.ok(!read.threads.some((t) => t.terms.includes('wrangler') || t.terms.includes('css-grid')), 'and neither bright zone threads — structurally unmintable');
});

// ── the window reads ────────────────────────────────────────────────────────────────────────────

test('the window read counts asks in context and engagement outside asks, over the whole window', () => {
  k = 0;
  const rows: Labelled[] = [
    mo('w', '2026-07-20T10:00:00Z', 'how come it works', { aiTerms: ['other'], saidLen: 100 }),
    mo('w', '2026-07-20T10:00:01Z', 'caching is fine now', { aiTerms: ['caching'], saidLen: 2000 }),
    mo('w', '2026-07-20T10:00:02Z', 'do the tests please', { aiTerms: ['workbench'], saidLen: 50 }),
    mo('w', '2026-07-20T10:00:03Z', 'ship it', { aiTerms: ['workbench'], saidLen: 50 }),
  ];
  const rituals = new Set(['how come']);
  const read = topicWindowRead(rows, ['caching'], adjacencyOf(rows), rituals, Date.parse('2026-07-21T00:00:00Z'), 7);
  assert.equal(read.sample, 4, 'the whole window is the denominator');
  assert.equal(read.askRate, 1 / 4, 'the ask counts because its ANSWER named the topic');
  assert.equal(read.engageRate, 1 / 4, 'the person typing the term outside an ask is engagement');
  const quiet = topicWindowRead(rows, ['caching'], adjacencyOf(rows), rituals, Date.parse('2026-09-01T00:00:00Z'), 7);
  assert.equal(quiet.sample, 0, 'a quiet window carries no evidence — the floors upstream keep it from reading as anything');
});

// ── the relative discriminator ──────────────────────────────────────────────────────────────────

const thread = (slug: string, answerKeys: string[], sameSession = false): TopicThread => ({
  terms: [slug],
  slug,
  askCount: answerKeys.length,
  askSessions: 3,
  spanDays: 10,
  bounces: 2,
  askKeys: answerKeys.map((a) => `ask-${a}`),
  answerKeys,
  answerSessions: answerKeys.map((_, i) => (sameSession ? 'one' : `sess${i}`)),
});

test('the discriminator is RELATIVE — the re-taught thread stands out against the corpus\'s own baseline', async () => {
  process.env.STRATLESS_FAKE_EMBED = '1';
  try {
    const heads = new Map<string, string>([
      // the re-taught thread: the same lesson re-opened the same way, three times
      ['a1', 'caching works by storing the computed result and reusing it on the next request'],
      ['a2', 'caching works by storing the computed result and reusing it on the next request'],
      ['a3', 'caching works by storing the computed result and reusing it later'],
      // three evolving threads: every answer opens somewhere new
      ['b1', 'the license question starts with what AGPL requires of derived work'],
      ['b2', 'distribution terms hinge on how the binary embeds the runtime pieces'],
      ['b3', 'a dual approach would separate the hosted offering from the library'],
      ['c1', 'positioning against incumbents means picking the axis they ignore'],
      ['c2', 'the fence idea keeps the standard open while the tooling differentiates'],
      ['c3', 'a launch ladder sequences the mirror before the tool itself'],
      ['d1', 'workers bind the queue through the environment configuration object'],
      ['d2', 'the durable object holds one websocket per active session cleanly'],
      ['d3', 'cron triggers fire the scheduled handler with a controller argument'],
    ]);
    const threads = [thread('caching', ['a1', 'a2', 'a3']), thread('agpl', ['b1', 'b2', 'b3']), thread('strategy', ['c1', 'c2', 'c3']), thread('workers', ['d1', 'd2', 'd3'])];
    const ran = await discriminate(threads, heads);
    assert.ok(ran, 'four candidate threads is a baseline');
    const [caching, ...rest] = threads;
    assert.ok(caching.simMargin! > 0.2, 'near-identical re-answers sit far above the corpus median');
    for (const t of rest) assert.ok(t.simMargin! < caching.simMargin!, 'evolving answers rank below the re-taught thread');
  } finally {
    delete process.env.STRATLESS_FAKE_EMBED;
  }
});

test('under four candidate threads the discriminator abstains — no baseline to be relative to', async () => {
  process.env.STRATLESS_FAKE_EMBED = '1';
  try {
    const heads = new Map<string, string>([
      ['a1', 'same answer text'],
      ['a2', 'same answer text'],
      ['b1', 'other answer text'],
      ['b2', 'different words entirely'],
    ]);
    const threads = [thread('one', ['a1', 'a2']), thread('two', ['b1', 'b2'])];
    const ran = await discriminate(threads, heads);
    assert.equal(ran, false, 'it refuses rather than inventing a baseline from two points');
    assert.ok(threads.every((t) => t.simMargin === undefined), 'and stamps nothing — an unstamped thread cannot mint');
  } finally {
    delete process.env.STRATLESS_FAKE_EMBED;
  }
});

test('a thread answered inside one conversation stays unstamped — context is not re-teaching', async () => {
  process.env.STRATLESS_FAKE_EMBED = '1';
  try {
    const heads = new Map<string, string>();
    for (const k of ['a1', 'a2', 'a3', 'b1', 'b2', 'c1', 'c2', 'd1', 'd2', 'e1', 'e2'])
      heads.set(k, `answer text for ${k[0]} repeated framing here`);
    const burst = thread('burst', ['a1', 'a2', 'a3'], true); // one session, identical answers
    const threads = [
      burst,
      thread('two', ['b1', 'b2']),
      thread('three', ['c1', 'c2']),
      thread('four', ['d1', 'd2']),
      thread('five', ['e1', 'e2']),
    ];
    const ran = await discriminate(threads, heads);
    assert.ok(ran, 'the cross-session threads form a baseline');
    assert.equal(burst.simMargin, undefined, 'the single-conversation burst has no re-teaching evidence and cannot mint');
    assert.ok(threads.slice(1).every((t) => typeof t.simMargin === 'number'), 'while the cross-session threads are stamped');
  } finally {
    delete process.env.STRATLESS_FAKE_EMBED;
  }
});

test('the span read is alive by construction — it brackets the asks it was born from', () => {
  const c = corpus();
  const read = topicsRead(c, undefined, fullOf(c))!;
  const t = read.threads[0];
  const span = topicSpanRead(c, t.terms, t.askKeys, adjacencyOf(c), new Set(read.rituals));
  assert.ok(span.askRate > 0, 'the birth baseline contains its own asks — an unfalsifiable topic cannot exist');
  assert.ok(span.sample > 0);
});
