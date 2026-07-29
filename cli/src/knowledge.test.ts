/**
 * KNOWLEDGE — the ledger's guarantees, pinned. The two that carry the leg: the bright zones are
 * STRUCTURALLY unmintable (the pre-registered dogfood expectation as a unit test), and a quiet
 * window can never read as learned (the sample floor + the engagement leg — absorbed, not decayed).
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, before, after } from 'node:test';

import {
  readKnowledge,
  writeKnowledge,
  mintable,
  portable,
  covers,
  nextKnowledgeState,
  deliverySpec,
  knowledgePrint,
  runKnowledge,
  metaLine,
  DELEGATED_LINE,
  type KnowledgeTopic,
  type KnowledgeHistoryEntry,
  type MetaEvidence,
} from './knowledge.js';
import type { TopicPile } from './topics.js';
import type { Labelled } from './count.js';
import type { Moment } from './moments.js';

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'stratless-knowledge-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ── fixture builders ────────────────────────────────────────────────────────────────────────────

const pile = (o: Partial<TopicPile> = {}): TopicPile => ({
  terms: ['caching'],
  slug: 'caching',
  askCount: 6,
  askSessions: 4,
  spanDays: 12,
  bounces: 2,
  askKeys: [],
  answerKeys: [],
  projects: 2,
  known: 6,
  dominant: 3,
  tightness: 0.9,
  tightMargin: 0.1,
  ...o,
});

const topic = (o: Partial<KnowledgeTopic> = {}): KnowledgeTopic => ({
  id: '2026-07-01·caching',
  bornAt: '2026-07-01T00:00:00Z',
  slug: 'caching',
  terms: ['caching', 'rebuilds'],
  pipeline: 'p1',
  bounces: 2,
  askCount: 6,
  askSessions: 4,
  tightMargin: 0.1,
  projects: 2,
  baseline: { askRate: 0.1, engageRate: 0.05 },
  row: 'talk caching mechanism-first, in layman, for me',
  history: [],
  lifecycle: 'open',
  ...o,
});

const meta = (o: Partial<MetaEvidence> = {}): MetaEvidence => ({
  asks: 48,
  sessions: 12,
  bounces: 14,
  specPhrases: ['in layman'],
  ...o,
});

const entry = (o: Partial<KnowledgeHistoryEntry> = {}): KnowledgeHistoryEntry => ({
  builtAt: '2026-07-20T00:00:00Z',
  askRate: 0.1,
  engageRate: 0.05,
  sessions: 2,
  sample: 50,
  ...o,
});

let mk = 0;
const mo = (session: string, ts: string, reply: string, o: { aiTerms?: string[]; saidLen?: number } = {}): Labelled => ({
  moment: {
    key: `m${mk++}`,
    session,
    ts,
    pile: 'ordinary',
    reply,
    replyLen: reply.length,
    ...(o.aiTerms ? { aiTerms: o.aiTerms } : {}),
    ...(o.saidLen !== undefined ? { saidLen: o.saidLen } : {}),
  } as Moment,
  kinds: [],
});

// ── the store ───────────────────────────────────────────────────────────────────────────────────

test('a corrupt or missing store degrades to empty — never a throw (the renders.json discipline)', () => {
  const p = join(dir, 'corrupt.json');
  writeFileSync(p, '{"topics": [{"id": 42}, "junk", {"id": "ok", "slug": "s", "terms": ["t"], "baseline": {"askRate": 0.1, "engageRate": 0}, "lifecycle": "sideways"}]}');
  const store = readKnowledge(p);
  assert.equal(store.topics.length, 1, 'malformed records are dropped, valid ones survive');
  assert.equal(store.topics[0].lifecycle, 'open', 'an unknown lifecycle falls back to open, never crashes');
  assert.deepEqual(readKnowledge(join(dir, 'absent.json')), { topics: [] });
});

test('the voiced row survives the store verbatim — voiced once, never re-worded', () => {
  const p = join(dir, 'verbatim.json');
  const row = 'talk wrangler mechanism before number, in layman, for me';
  writeKnowledge({ topics: [topic({ row })] }, p);
  const print = knowledgePrint(p);
  assert.equal(print.rows[0].row, row, 'the stored text is the printed text, byte for byte');
});

// ── the mint gate ───────────────────────────────────────────────────────────────────────────────

test('the evidence gate: two bounces mint, one bounce needs the re-ask spread, zero bounces never mint', () => {
  assert.ok(mintable(pile({ bounces: 2, askSessions: 2 })), 'two bounces alone clear it');
  assert.ok(mintable(pile({ bounces: 1, askSessions: 3 })), 'one bounce plus asks across three sessions clears it');
  assert.ok(!mintable(pile({ bounces: 1, askSessions: 2 })), 'one bounce without the spread does not');
  assert.ok(!mintable(pile({ bounces: 0, askSessions: 9 })), 'no bounce, no mint — however often they asked');
});

test('the portability gate — a named row may only describe a subject that travels (direction C)', () => {
  assert.ok(portable(pile()), 'two known projects, no dominance — travels');
  assert.ok(!portable(pile({ projects: 1, dominant: 6 })), 'one project is project-bound — meta evidence, never a named row');
  assert.ok(!portable(pile({ projects: 2, known: 6, dominant: 5 })), 'one project dominating is project-bound in practice');
  assert.ok(!portable(pile({ projects: 2, known: 2, dominant: 1 })), 'unknown provenance blocks — a majority must carry a known project');
  assert.ok(!mintable(pile({ projects: 1, dominant: 6 })), 'and the mint gate enforces it');
});

test('an unstamped or low-margin thread cannot mint — the discriminator leg is structural', () => {
  assert.ok(!mintable(pile({ tightness: undefined, tightMargin: undefined })), 'runtime absent or too few piles → unstamped → unmintable');
  assert.ok(!mintable(pile({ tightMargin: 0.01 })), 'evolving answers (co-construction) sit at or below the median');
  assert.ok(mintable(pile({ tightMargin: 0.05 })), 're-teaching clears the margin');
});

test('covered is forever — same slug or a majority of lead terms shared', () => {
  const existing = topic({ slug: 'caching', terms: ['caching', 'rebuilds', 'vectors'] });
  assert.ok(covers(existing, pile({ slug: 'caching' })), 'same slug');
  assert.ok(covers(existing, pile({ slug: 'rebuilds-caching', terms: ['rebuilds', 'caching', 'other'] })), 'majority overlap');
  assert.ok(!covers(existing, pile({ slug: 'agpl', terms: ['agpl', 'license'] })), 'a different topic is not covered');
});

// ── the lifecycle ───────────────────────────────────────────────────────────────────────────────

const NOW = Date.parse('2026-07-28T00:00:00Z');

test('learned: asks fade WHILE engagement holds — absorbed, not decayed', () => {
  const t = topic({
    history: [entry({ askRate: 0.04, engageRate: 0.05 }), entry({ builtAt: '2026-07-27T00:00:00Z', askRate: 0.03, engageRate: 0.04 })],
  });
  assert.equal(nextKnowledgeState(t, NOW), 'learned');
});

test('a quiet window never reads as learned — the sample floor holds', () => {
  const t = topic({
    history: [entry({ askRate: 0, engageRate: 0.05, sample: 10 }), entry({ builtAt: '2026-07-27T00:00:00Z', askRate: 0, engageRate: 0.05, sample: 10 })],
  });
  assert.equal(nextKnowledgeState(t, NOW), 'open', 'ten moments of quiet is not evidence of anything');
});

test('engagement collapse blocks learned — asks fading with the topic leaving their work is not absorption', () => {
  const t = topic({
    history: [entry({ askRate: 0.03, engageRate: 0.01 }), entry({ builtAt: '2026-07-27T00:00:00Z', askRate: 0.03, engageRate: 0.01 })],
  });
  assert.equal(nextKnowledgeState(t, NOW), 'open');
});

test('no birth engagement, no learned — absorbed-vs-decay needs a second hand to read', () => {
  const t = topic({
    baseline: { askRate: 0.1, engageRate: 0 },
    history: [entry({ askRate: 0.02 }), entry({ builtAt: '2026-07-27T00:00:00Z', askRate: 0.02 })],
  });
  assert.equal(nextKnowledgeState(t, NOW), 'open', 'the exit that cannot be evidenced cannot fire');
});

test('lapsed: the topic left their work — no credit, no fault', () => {
  const t = topic({
    bornAt: '2026-05-01T00:00:00Z',
    history: [entry({ builtAt: '2026-05-20T00:00:00Z', askRate: 0, engageRate: 0, sessions: 0 }), entry({ builtAt: '2026-07-20T00:00:00Z', askRate: 0, engageRate: 0, sessions: 0 })],
  });
  assert.equal(nextKnowledgeState(t, NOW), 'lapsed', 'the last sign of life is beyond the lapse window');
});

test('falsified: the asks persisted through six solid builds — the row was wrong for them', () => {
  const h: KnowledgeHistoryEntry[] = [];
  for (let i = 0; i < 6; i++) h.push(entry({ builtAt: `2026-07-${String(10 + i * 3).padStart(2, '0')}T00:00:00Z`, askRate: 0.09, engageRate: 0.02, sessions: 2 }));
  const t = topic({ bornAt: '2026-05-01T00:00:00Z', history: h });
  assert.equal(nextKnowledgeState(t, Date.parse('2026-07-28T00:00:00Z')), 'falsified');
});

// ── the delivery spec ───────────────────────────────────────────────────────────────────────────

test('the delivery spec is DERIVED from their ask modifiers — and honestly empty when nothing recurs', () => {
  mk = 0;
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
  mk = 0;
  const rituals = new Set(['explain to me']);
  const rows: Labelled[] = [];
  for (let i = 0; i < 12; i++) {
    rows.push(mo(`s${i % 4}`, `2026-07-0${1 + (i % 4)}T10:00:${String(i).padStart(2, '0')}Z`, `explain to me in layman what i want to see here ${i}`));
    // the same "what i want" grammar, everywhere OUTSIDE asks too
    rows.push(mo(`s${i % 4}`, `2026-07-0${1 + (i % 4)}T10:01:${String(i).padStart(2, '0')}Z`, `ok so what i want to do next is ship piece ${i}`));
  }
  const spec = deliverySpec(rows, rituals);
  assert.ok(spec.some((d) => d.phrase === 'in layman'), 'the ask-exclusive modifier survives');
  assert.ok(!spec.some((d) => d.phrase.includes('want')), 'the everywhere-grammar is excluded — measured junk on the real archive');
});

// ── the run ─────────────────────────────────────────────────────────────────────────────────────

test('refuse, don\'t lie — a pre-v3 pile runs nothing and touches nothing', async () => {
  mk = 0;
  const old = [mo('s1', '2026-07-01T10:00:00Z', 'how come it works'), mo('s1', '2026-07-01T10:00:01Z', 'ok')];
  const p = join(dir, 'norun.json');
  const r = await runKnowledge(undefined, old, NOW, { file: p });
  assert.deepEqual(r, { minted: 0, retired: 0, open: 0, changed: false });
  assert.deepEqual(readKnowledge(p), { topics: [] }, 'the store was never created');
});

test('the run re-measures open topics and retires what earned an exit — without a model call or a walk', async () => {
  mk = 0;
  // A pile that carries the topic channel but no longer touches the stored topic. The roots are
  // empty on purpose: retirement is cards-only and must never stall on the raw-archive walk.
  const pile: Labelled[] = [];
  for (let i = 0; i < 6; i++) pile.push(mo(`s${i % 2}`, `2026-07-2${i % 6}T10:00:00Z`, 'do the tests please', { aiTerms: ['workbench'], saidLen: 50 }));
  const p = join(dir, 'retire.json');
  const emptyRoots = mkdtempSync(join(tmpdir(), 'stratless-noarchive-'));
  writeKnowledge(
    {
      topics: [
        topic({
          bornAt: '2026-05-01T00:00:00Z',
          history: [entry({ builtAt: '2026-05-20T00:00:00Z', askRate: 0, engageRate: 0, sessions: 0 })],
        }),
      ],
    },
    p,
  );
  const r = await runKnowledge(undefined, pile, NOW, { file: p, roots: [emptyRoots] });
  assert.equal(r.retired, 1, 'the lapsed exit fired from arithmetic alone');
  assert.equal(readKnowledge(p).topics[0].lifecycle, 'lapsed');
  assert.equal(r.open, 0);
  rmSync(emptyRoots, { recursive: true, force: true });
});

// ── the print surface ───────────────────────────────────────────────────────────────────────────

test('at most two rows print, bounce-heaviest first, with the key lines the evidence earns', () => {
  const p = join(dir, 'print.json');
  writeKnowledge(
    {
      topics: [
        topic({ id: 'a', slug: 'aaa', bounces: 1, row: 'talk aaa grounded for me' }),
        topic({ id: 'b', slug: 'bbb', bounces: 5, row: 'talk bbb grounded for me' }),
        topic({ id: 'c', slug: 'ccc', bounces: 3, row: 'talk ccc grounded for me' }),
        topic({ id: 'd', slug: 'ddd', bounces: 9, row: 'talk ddd grounded for me', lifecycle: 'learned' }),
      ],
      delegatedZones: 4,
      meta: meta(),
    },
    p,
  );
  const print = knowledgePrint(p);
  assert.deepEqual(print.rows.map((r) => r.row), ['talk bbb grounded for me', 'talk ccc grounded for me'], 'capped at two, bounce-heaviest, retired rows gone — the file thins');
  assert.deepEqual(print.keyLines, [metaLine(meta()), DELEGATED_LINE], 'the meta line and, with delegated zones present, the delegated line');
});

test('the meta line is THE C SURFACE — it stands on its own evidence, named row or not', () => {
  const p = join(dir, 'metaonly.json');
  writeKnowledge({ topics: [], delegatedZones: 2, meta: meta({ bounces: 14 }) }, p);
  const print = knowledgePrint(p);
  assert.deepEqual(print.rows, [], 'no portable topic qualified — no named row');
  assert.equal(print.keyLines.length, 2, 'the signature and the delegated line still print (the founder\'s call, 2026-07-29)');
  assert.ok(print.keyLines[0].includes('in layman'), 'the person\'s own derived delivery phrase is embedded');
  assert.ok(print.keyLines[0].includes("14 didn't land"), 'and the receipt is the measured evidence');
});

test('below the meta floor the leg leaves no trace — a couple of stray bounces is not a signature', () => {
  const p = join(dir, 'empty.json');
  writeKnowledge({ topics: [topic({ lifecycle: 'learned' })], delegatedZones: 3, meta: meta({ bounces: 2 }) }, p);
  const print = knowledgePrint(p);
  assert.deepEqual(print.rows, []);
  assert.deepEqual(print.keyLines, [], 'no rows, evidence under the floor → nothing prints, delegated line included');
});
