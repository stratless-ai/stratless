/**
 * ASKS — the mode-2 witness's guarantees, pinned. The ones that matter most: the ask detector is
 * DERIVED from the corpus in front of it (an invented ritual on a synthetic corpus must qualify;
 * a corpus without the pattern must yield none — zero is legal), the bright zones map without a
 * model, and the delivery spec never surfaces the person's grammar or their ritual fragments as
 * modifiers (both junk classes were measured on the real archive).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { adjacencyOf, type Labelled } from './count.js';
import type { Moment } from './moments.js';
import { askRituals, asksRead, askWindowRead, askSpanRead, deliverySpec, metaEvidence, metaLine } from './asks.js';

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
 * with short answers keeps the base explanation rate low, plus a `wrangler` zone the person TYPES
 * without asking, a `css-grid` zone the assistant mentions and the person never touches, and
 * `workbench` everywhere (background vocabulary the rare band must exclude).
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
  const read = asksRead(flat, undefined, fullOf(flat));
  assert.ok(read, 'the pile carries the answer channel, so the read runs');
  assert.deepEqual(read!.rituals, [], 'no phrase earned ritual status');
  assert.deepEqual(read!.events, [], 'and no ask exists — the honest empty answer');
});

test('refuse, don\'t lie — no answer channel or no walk reads as undefined, not as "this person never asks"', () => {
  k = 0;
  const old: Labelled[] = [mo('s1', '2026-07-01T10:00:00Z', 'how come it works'), mo('s1', '2026-07-01T10:00:01Z', 'ok')];
  assert.equal(asksRead(old), undefined, 'a pre-v3 pile must not claim the person never asks');
  const v3 = [mo('s1', '2026-07-01T10:00:02Z', 'ok', { aiTerms: ['caching'], saidLen: 900 })];
  assert.equal(asksRead(v3, undefined, { df: new Map(), answers: 0 }), undefined, 'and a walk that found nothing refuses too — the rare band may not be judged on a falsified basis');
});

test('the corpus locates its asks and the bounce — the explanation that came straight back', () => {
  k = 0;
  const c = ritualCorpus();
  c.push(mo('s1', '2026-07-01T11:00:00Z', 'how come it works', { aiTerms: ['workbench'], saidLen: 100 }));
  c.push(mo('s1', '2026-07-01T11:00:01Z', 'how come it fails', { aiTerms: ['caching', 'details'], saidLen: 2000 }));
  c.push(mo('s1', '2026-07-01T11:00:02Z', 'ok', { aiTerms: ['caching', 'details'], saidLen: 2000 }));
  const read = asksRead(c, undefined, fullOf(c))!;
  assert.equal(read.events.length, 14, 'twelve planted asks, the bounce block\'s opener, and its immediate re-ask');
  assert.equal(read.events.filter((e) => e.bounced).length, 1, 'exactly one explanation came straight back');
});

// ── the bright zones ────────────────────────────────────────────────────────────────────────────

test('strong and delegated are mapped, and background vocabulary is neither', () => {
  const c = ritualCorpus();
  const read = asksRead(c, undefined, fullOf(c))!;
  assert.ok(read.strong.includes('wrangler'), 'typed in their own replies without asking — strength');
  assert.ok(read.delegated.includes('css-grid'), 'the assistant keeps saying it, the person never enters — delegation');
  assert.ok(!read.strong.includes('workbench') && !read.delegated.includes('workbench'), 'background vocabulary is outside the rare band');
  assert.ok(!read.delegated.includes('caching'), 'an asked-about term is never delegated — they enter that zone');
});

// ── the evidence surfaces ───────────────────────────────────────────────────────────────────────

test('the meta evidence counts every located ask, and the signature line templates it with the receipt', () => {
  k = 0;
  const c = ritualCorpus();
  const read = asksRead(c, undefined, fullOf(c))!;
  const meta = metaEvidence(read, [{ phrase: 'in layman', count: 12 }]);
  assert.equal(meta.asks, read.events.length);
  assert.equal(meta.bounces, 0, 'no bounce was planted in the base corpus');
  const line = metaLine({ asks: 563, sessions: 88, bounces: 52, specPhrases: [] });
  assert.equal(
    line,
    "my questions circle a mechanism → drop a level: mechanism before number (563× across 88 conversations, 52 didn't land)",
    'the template over the measured numbers — a template cannot wobble',
  );
  assert.ok(metaLine(meta).includes('in layman'), 'the person\'s own derived phrase embeds when one exists');
});

test('the delivery spec is DERIVED from their ask modifiers — and honestly empty when nothing recurs', () => {
  k = 0;
  const rituals = new Set(['explain to me']);
  const asks: Labelled[] = [];
  const tails = ['how caching works', 'what the pool does', 'why it rebuilds twice', 'where the cache lives'];
  for (let i = 0; i < 12; i++) asks.push(mo(`s${i % 4}`, `2026-07-0${1 + (i % 4)}T10:00:${String(i).padStart(2, '0')}Z`, `explain to me in layman ${tails[i % 4]}`));
  const spec = deliverySpec(asks, rituals);
  assert.ok(spec.some((d) => d.phrase === 'in layman'), 'their own recurring modifier surfaces with its count');
  assert.ok(!spec.some((d) => d.phrase.includes('explain')), 'the ritual itself never enters the spec');
  assert.deepEqual(deliverySpec([mo('s1', '2026-07-01T10:00:00Z', 'explain to me how it works')], rituals), [], 'one ask proves no spec — never defaulted');
});

test('a gram the person uses everywhere is their grammar, not a delivery modifier — ask-share holds', () => {
  k = 0;
  const rituals = new Set(['explain to me']);
  const rows: Labelled[] = [];
  for (let i = 0; i < 12; i++) {
    rows.push(mo(`s${i % 4}`, `2026-07-0${1 + (i % 4)}T10:00:${String(i).padStart(2, '0')}Z`, `explain to me in layman what i want to see here ${i}`));
    rows.push(mo(`s${i % 4}`, `2026-07-0${1 + (i % 4)}T10:01:${String(i).padStart(2, '0')}Z`, `ok so what i want to do next is ship piece ${i}`));
  }
  const spec = deliverySpec(rows, rituals);
  assert.ok(spec.some((d) => d.phrase === 'in layman'), 'the ask-exclusive modifier survives');
  assert.ok(!spec.some((d) => d.phrase.includes('want')), 'the everywhere-grammar is excluded — measured junk on the real archive');
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
  const read = askWindowRead(rows, ['caching'], adjacencyOf(rows), rituals, Date.parse('2026-07-21T00:00:00Z'), 7);
  assert.equal(read.sample, 4, 'the whole window is the denominator');
  assert.equal(read.askRate, 1 / 4, 'the ask counts because its ANSWER named the zone');
  assert.equal(read.engageRate, 1 / 4, 'the person typing the term outside an ask is engagement');
  const quiet = askWindowRead(rows, ['caching'], adjacencyOf(rows), rituals, Date.parse('2026-09-01T00:00:00Z'), 7);
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
  const span = askSpanRead(rows, ['caching'], [rows[0].moment.key, rows[2].moment.key], adjacencyOf(rows), rituals);
  assert.ok(span.askRate > 0, 'the birth baseline contains its own asks — an unfalsifiable patch cannot exist');
  assert.ok(span.sample > 0);
});
