/**
 * TOPICS — the knowledge read's guarantees, pinned. The ones that matter most: the ask detector is
 * DERIVED from the corpus in front of it (an invented ritual on a synthetic corpus must qualify; a
 * corpus without the pattern must yield none — zero is legal), a topic is a PILE of answers with
 * one owner per ask and per bounce (the felt-gate re-founding: token threads sprayed credit), and
 * a pile's re-teaching stamp exists only where a cross-session baseline can be honest.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { adjacencyOf, type Labelled } from './count.js';
import type { Moment } from './moments.js';
import {
  askRituals,
  topicsRead,
  topicPiles,
  topicWindowRead,
  topicSpanRead,
  aiShapeOf,
  type AskEvent,
  type AnswerWalk,
} from './topics.js';

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
 * A synthetic archive with a planted ask ritual: in each of four sessions the person asks with
 * "how come …" and the assistant answers with a long prose explanation; around them, filler work
 * with short answers keeps the base explanation rate low.
 */
function ritualCorpus(): Labelled[] {
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
      out.push(mo(sess, at(), 'how come it works', { aiTerms: ['workbench'], saidLen: 100 }));
      out.push(mo(sess, at(), 'ok fine', { aiTerms: ['caching', 'details'], saidLen: 2000, calls: 0 }));
      filler();
    }
    if (s < 2) filler('the wrangler setup is fine today', ['workbench', 'wrangler']);
    filler();
  }
  return out;
}

// ── the detector ────────────────────────────────────────────────────────────────────────────────

test('the ask ritual is DERIVED from the corpus — the invented phrase qualifies, the work phrase does not', () => {
  const c = ritualCorpus();
  const rituals = askRituals(c, adjacencyOf(c));
  assert.ok([...rituals].some((p) => p.startsWith('how come')), 'the planted ritual was mined from adjacency alone');
  assert.ok(![...rituals].some((p) => p.startsWith('do the')), 'the work phrase is answered with work, not explanations');
});

test('a corpus without the ask pattern yields no rituals and no events — zero is legal', () => {
  k = 0;
  const flat: Labelled[] = [];
  for (let i = 0; i < 20; i++)
    flat.push(mo(`s${i % 4}`, `2026-07-0${1 + (i % 4)}T10:00:${String(i).padStart(2, '0')}Z`, 'do the tests please', { aiTerms: ['workbench'], saidLen: 50 }));
  const read = topicsRead(flat, undefined, fullOf(flat));
  assert.ok(read, 'the pile carries the topic channel, so the read runs');
  assert.deepEqual(read!.rituals, [], 'no phrase earned ritual status');
  assert.deepEqual(read!.events, [], 'and no ask exists — the honest empty answer');
});

test('refuse, don\'t lie — no topic channel or no walk reads as undefined, not as "no topics"', () => {
  k = 0;
  const old: Labelled[] = [mo('s1', '2026-07-01T10:00:00Z', 'how come it works'), mo('s1', '2026-07-01T10:00:01Z', 'ok')];
  assert.equal(topicsRead(old), undefined, 'a pre-v3 pile must not claim the person has no topics');
  const v3 = [mo('s1', '2026-07-01T10:00:02Z', 'ok', { aiTerms: ['caching'], saidLen: 900 })];
  assert.equal(topicsRead(v3, undefined, { df: new Map(), answers: 0 }), undefined, 'and a walk that found nothing refuses too — the rare band may not be judged on a falsified basis');
});

test('the ritual corpus locates its asks and the bounce — the explanation that came straight back', () => {
  k = 0;
  const c = ritualCorpus();
  // append a bounce block: ask → explanation whose reply is itself an ask
  c.push(mo('s1', '2026-07-01T11:00:00Z', 'how come it works', { aiTerms: ['workbench'], saidLen: 100 }));
  c.push(mo('s1', '2026-07-01T11:00:01Z', 'how come it fails', { aiTerms: ['caching', 'details'], saidLen: 2000 }));
  c.push(mo('s1', '2026-07-01T11:00:02Z', 'ok', { aiTerms: ['caching', 'details'], saidLen: 2000 }));
  const read = topicsRead(c, undefined, fullOf(c))!;
  assert.equal(read.events.length, 14, 'twelve planted asks, the bounce block\'s opener, and its immediate re-ask');
  assert.equal(read.events.filter((e) => e.bounced).length, 1, 'exactly one explanation came straight back');
});

// ── the bright zones ────────────────────────────────────────────────────────────────────────────

test('strong and delegated are mapped, and background vocabulary is neither', () => {
  const c = ritualCorpus();
  const read = topicsRead(c, undefined, fullOf(c))!;
  assert.ok(read.strong.includes('wrangler'), 'typed in their own replies without asking — strength');
  assert.ok(read.delegated.includes('css-grid'), 'the assistant keeps saying it, the person never enters — delegation');
  assert.ok(!read.strong.includes('workbench') && !read.delegated.includes('workbench'), 'background vocabulary is outside the rare band');
  assert.ok(!read.delegated.includes('caching'), 'an asked-about term is never delegated — they enter that topic');
});

// ── the AI shape channel ────────────────────────────────────────────────────────────────────────

test('aiShapeOf drops the assistant\'s register and keeps the subject — the mirror of shapeOf', () => {
  const common = new Set(['honest', 'answer', 'let', 'the', 'and', 'here']);
  const shaped = aiShapeOf('Honest answer: let the caching layer store results here', common);
  assert.ok(!/honest|answer|let\b|here/i.test(shaped), 'the rhetoric is gone');
  assert.ok(shaped.includes('caching') && shaped.includes('store'), 'the subject survives');
  assert.equal(aiShapeOf('honest answer here', common), 'honest answer here', 'an answer that empties falls back to its original text — pure rhetoric still embeds as something');
});

// ── the pile construction ───────────────────────────────────────────────────────────────────────

/** Hand-built events + walk stub: four planted subjects, each with its own repeated answer text
 *  (identical texts per subject make the fake-vector geometry exact), one evolving subject whose
 *  every answer differs, and one below-bar subject. */
function pileFixture(): { events: AskEvent[]; labelled: Labelled[]; walk: AnswerWalk } {
  k = 0;
  const labelled: Labelled[] = [];
  const events: AskEvent[] = [];
  const heads = new Map<string, string>();
  const projects = new Map<string, string>();
  const df = new Map<string, number>();
  const days = ['2026-07-01', '2026-07-05', '2026-07-10', '2026-07-14'];

  const subject = (
    name: string,
    text: (i: number) => string,
    terms: string[],
    n: number,
    opts: { bounceAt?: number; project?: (i: number) => string | undefined; oneSession?: boolean } = {},
  ) => {
    for (let i = 0; i < n; i++) {
      const sess = opts.oneSession ? `${name}-s0` : `${name}-s${i % 3}`;
      const ts = `${days[i % (opts.oneSession ? 1 : 4)]}T10:00:${String(i).padStart(2, '0')}Z`;
      const ask = mo(sess, ts, 'how come it works', { saidLen: 100 });
      const answer = mo(sess, ts.replace('T10:00', 'T10:01'), i === opts.bounceAt ? 'how come it fails' : 'ok', {
        aiTerms: terms,
        saidLen: 2000,
      });
      labelled.push(ask, answer);
      heads.set(answer.moment.key, text(i));
      const p = opts.project?.(i);
      if (p) projects.set(answer.moment.key, p);
      for (const t of new Set(terms)) df.set(t, (df.get(t) ?? 0) + 1);
      events.push({ key: ask.moment.key, session: sess, ts: Date.parse(ts), answerKey: answer.moment.key, bounced: i === opts.bounceAt });
    }
  };

  // Tight clouds (a heavy shared core, one varying tail word — real answers are never identical)
  // and one LOOSE cloud whose answers keep wandering: the re-taught vs co-construction contrast.
  subject('caching', (i) => `the caching layer stores computed results and reuses them on later requests cachetail${i}`, ['caching', 'store'], 12, {
    bounceAt: 3,
    project: (i) => (i % 2 ? 'proj-a' : 'proj-b'),
  });
  subject('deploy', (i) => `wrangler publishes the worker bundle to the edge network with rotated secrets deploytail${i}`, ['wrangler', 'deploy'], 12, {
    project: () => 'proj-a',
  });
  subject('license', (i) => `the agpl license obliges derived network services to publish their own source licensetail${i}`, ['agpl', 'license'], 12, {
    project: (i) => (i % 2 ? 'proj-a' : 'proj-b'),
  });
  subject('evolving', (i) => `the strategy positioning discussion keeps moving between markets fresh${i} angle${i} pitch${i}`, ['strategy'], 12, {
    project: (i) => (i % 2 ? 'proj-a' : 'proj-b'),
  });
  subject('tiny', () => 'a subject asked about too rarely to exist', ['tiny'], 3);
  return { events, labelled, walk: { df, answers: 60, heads, projects } };
}

test('subjects come out as piles — one owner per ask and per bounce, the bar holds, and it is deterministic', async () => {
  process.env.STRATLESS_FAKE_EMBED = '1';
  try {
    const { events, labelled, walk } = pileFixture();
    const piles = await topicPiles(events, labelled, walk);
    assert.ok(piles.length >= 4, 'the four real subjects survive');
    assert.ok(!piles.some((p) => p.terms.includes('tiny')), 'three asks are a curiosity, not a topic — the bar holds');
    const caching = piles.find((p) => p.terms.includes('caching'))!;
    assert.ok(caching, 'the planted subject names itself from its members\' cards');
    assert.ok(!caching.terms.includes('wrangler'), 'subjects do not blur into each other');
    assert.equal(piles.reduce((a, p) => a + p.bounces, 0), 1, 'ONE bounce, owned by ONE pile — no spray');
    assert.equal(caching.bounces, 1, 'and it is the pile whose explanation failed');
    const again = await topicPiles(events, labelled, walk);
    assert.deepEqual(again, piles, 'same corpus, same piles — byte-identical on repeat');
  } finally {
    delete process.env.STRATLESS_FAKE_EMBED;
  }
});

test('the portability facts ride each pile — spread vs single-project vs unknown provenance', async () => {
  process.env.STRATLESS_FAKE_EMBED = '1';
  try {
    const { events, labelled, walk } = pileFixture();
    const piles = await topicPiles(events, labelled, walk);
    const caching = piles.find((p) => p.terms.includes('caching'))!;
    const deploy = piles.find((p) => p.terms.includes('wrangler'))!;
    assert.equal(caching.projects, 2, 'the travelling subject spans two known projects');
    assert.equal(deploy.projects, 1, 'the project-bound subject shows one');
    assert.equal(deploy.dominant, deploy.known, 'and its dominant count is all of it');
  } finally {
    delete process.env.STRATLESS_FAKE_EMBED;
  }
});

test('re-teaching is cross-session tightness, relative — the evolving subject ranks below the re-taught ones', async () => {
  process.env.STRATLESS_FAKE_EMBED = '1';
  try {
    const { events, labelled, walk } = pileFixture();
    const piles = await topicPiles(events, labelled, walk);
    const stamped = piles.filter((p) => typeof p.tightMargin === 'number');
    assert.ok(stamped.length >= 4, 'a baseline existed, so margins were stamped');
    const caching = piles.find((p) => p.terms.includes('caching'))!;
    const evolvers = piles.filter((p) => p.terms.includes('strategy') && typeof p.tightMargin === 'number');
    for (const e of evolvers) assert.ok(e.tightMargin! < caching.tightMargin!, 'answers that wander rank below the re-delivered lesson');
  } finally {
    delete process.env.STRATLESS_FAKE_EMBED;
  }
});

test('a subject answered inside one conversation stays unstamped — context is not re-teaching', async () => {
  process.env.STRATLESS_FAKE_EMBED = '1';
  try {
    const { events, labelled, walk } = pileFixture();
    // one more subject, all in one session (span fails too, so widen its dates by hand)
    k = 1000;
    const sess = 'burst-s0';
    for (let i = 0; i < 8; i++) {
      const ts = `2026-07-0${1 + (i % 4) * 2}T12:00:0${i}Z`; // spans days but ONE session
      const ask = mo(sess, ts, 'how come', { saidLen: 100 });
      const answer = mo(sess, ts.replace('T12:00', 'T12:01'), 'ok', { aiTerms: ['burst'], saidLen: 2000 });
      labelled.push(ask, answer);
      walk.heads.set(answer.moment.key, 'the burst subject repeats itself identically in one conversation');
      walk.df.set('burst', (walk.df.get('burst') ?? 0) + 1);
      events.push({ key: ask.moment.key, session: sess, ts: Date.parse(ts), answerKey: answer.moment.key, bounced: false });
    }
    const piles = await topicPiles(events, labelled, walk);
    const burst = piles.find((p) => p.terms.includes('burst'));
    // the bar needs ≥3 sessions, so the burst pile should not even exist
    assert.equal(burst, undefined, 'one conversation cannot be a topic at all — the session bar holds');
  } finally {
    delete process.env.STRATLESS_FAKE_EMBED;
  }
});

test('too few answers to cluster — the honest empty answer, not a guess', async () => {
  process.env.STRATLESS_FAKE_EMBED = '1';
  try {
    k = 0;
    const ask = mo('s1', '2026-07-01T10:00:00Z', 'how come', { saidLen: 100 });
    const answer = mo('s1', '2026-07-01T10:01:00Z', 'ok', { aiTerms: ['caching'], saidLen: 2000 });
    const events: AskEvent[] = [{ key: ask.moment.key, session: 's1', ts: Date.parse('2026-07-01T10:00:00Z'), answerKey: answer.moment.key, bounced: false }];
    const walk: AnswerWalk = { df: new Map([['caching', 3]]), answers: 3, heads: new Map([[answer.moment.key, 'text']]), projects: new Map() };
    assert.deepEqual(await topicPiles(events, [ask, answer], walk), [], 'below the floor the geometry means nothing');
  } finally {
    delete process.env.STRATLESS_FAKE_EMBED;
  }
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

test('the span read is alive by construction — it brackets the asks it was born from', () => {
  k = 0;
  const rows: Labelled[] = [
    mo('w', '2026-07-18T10:00:00Z', 'how come it works', { aiTerms: ['caching'], saidLen: 100 }),
    mo('w', '2026-07-18T10:00:01Z', 'ok', { aiTerms: ['caching'], saidLen: 2000 }),
    mo('w', '2026-07-20T10:00:00Z', 'how come again', { aiTerms: ['caching'], saidLen: 100 }),
  ];
  const rituals = new Set(['how come']);
  const span = topicSpanRead(rows, ['caching'], [rows[0].moment.key, rows[2].moment.key], adjacencyOf(rows), rituals);
  assert.ok(span.askRate > 0, 'the birth baseline contains its own asks — an unfalsifiable topic cannot exist');
  assert.ok(span.sample > 0);
});
