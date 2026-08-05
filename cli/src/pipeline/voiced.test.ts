/**
 * VOICED — the voice cache's guarantees, pinned. The ones that carry it: identity is
 * (name, bornAt) so a reborn generation NEVER inherits a dead generation's words; a full cache
 * hit voices nothing (the steady-state daily flush is $0); a register row whose quote-proof left
 * the candidate pool re-voices alone; a cached `none` stays cached (a rejected category is never
 * re-billed); a corrupt cache degrades to empty (one re-voicing, never a lie); and the store
 * prunes itself to the live generation set.
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, before, after } from 'node:test';

import { groupKeyOf, readVoiced, rememberGroups, rememberVoiced, voicingPlan, writeVoiced, type VoicedGroup, type VoicedRow, type VoiceWork } from './voiced.js';

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'stratless-voiced-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ── fixture builders ────────────────────────────────────────────────────────────────────────────

const GEN = '2026-07-26T00:00:00Z';

const row = (o: Partial<VoicedRow> = {}): VoicedRow => ({
  name: 'plan-first',
  bornAt: GEN,
  section: 'judge',
  line: 'offer to enter plan mode before touching code',
  signal: 'lets plan',
  quote: '',
  voicedAt: '2026-07-30T00:00:00Z',
  ...o,
});

const work = (o: Partial<VoiceWork> = {}): VoiceWork => ({
  name: 'plan-first',
  bornAt: GEN,
  candidateReplies: ['I will draft the plan first.'],
  ...o,
});

// ── the store ───────────────────────────────────────────────────────────────────────────────────

test('read: missing file, corrupt JSON, and malformed rows all degrade to empty — never throw', () => {
  assert.deepEqual(readVoiced('claude-code', join(dir, 'absent.json')), { rows: [], groups: [] });

  const corrupt = join(dir, 'corrupt.json');
  writeFileSync(corrupt, '{not json');
  assert.deepEqual(readVoiced('claude-code', corrupt), { rows: [], groups: [] });

  const malformed = join(dir, 'malformed.json');
  writeFileSync(
    malformed,
    JSON.stringify({
      rows: [
        row(),
        { name: 'no-born-at', section: 'frame', line: 'x', signal: '', quote: '' },
        { ...row({ name: 'bad-section' }), section: 'preamble' },
        'not even an object',
      ],
    }),
  );
  const got = readVoiced('claude-code', malformed);
  assert.equal(got.rows.length, 1);
  assert.equal(got.rows[0].name, 'plan-first');
});

test('write/read round-trips every field, voicedAt included', () => {
  const file = join(dir, 'roundtrip.json');
  const r = row({ section: 'register', quote: 'the exact reply text' });
  writeVoiced({ rows: [r] }, 'claude-code', file);
  assert.deepEqual(readVoiced('claude-code', file), { rows: [r], groups: [] });
});

// ── voicingPlan — the split decision ────────────────────────────────────────────────────────────

test('full cache hit: zero missing, every row reused — the steady-state flush voices nothing', () => {
  const store = { rows: [row(), row({ name: 'terse-briefs', section: 'frame', signal: '' })] };
  const plan = voicingPlan([work(), work({ name: 'terse-briefs' })], store);
  assert.deepEqual(plan.missing, []);
  assert.deepEqual(plan.replace, []);
  assert.equal(plan.reuse.size, 2);
  assert.equal(plan.reuse.get('plan-first')?.line, 'offer to enter plan mode before touching code');
});

test('generation flip: a cached name with a different bornAt is a miss — dead words never carry over', () => {
  const store = { rows: [row()] };
  const plan = voicingPlan([work({ bornAt: '2026-08-01T00:00:00Z' })], store);
  assert.deepEqual(plan.missing, ['plan-first']);
  assert.equal(plan.reuse.size, 0);
});

test('register proof: a quote still in the candidates reuses; a lost quote re-voices that ONE row', () => {
  const held = row({ name: 'held', section: 'register', quote: 'still here' });
  const lost = row({ name: 'lost', section: 'register', quote: 'gone from the pool' });
  const store = { rows: [held, lost] };
  const plan = voicingPlan(
    [work({ name: 'held', candidateReplies: ['still here', 'another'] }), work({ name: 'lost', candidateReplies: ['another'] })],
    store,
  );
  assert.deepEqual(plan.missing, ['lost']);
  assert.equal(plan.reuse.get('held'), held);
});

test('a cached none is a hit, not a miss — a rejected category is never re-billed', () => {
  const store = { rows: [row({ section: 'none', line: '', signal: '' })] };
  const plan = voicingPlan([work()], store);
  assert.deepEqual(plan.missing, []);
  assert.equal(plan.reuse.get('plan-first')?.section, 'none');
});

test('frame and judge rows need no quote-proof — an empty quote reuses regardless of candidates', () => {
  const store = { rows: [row({ section: 'frame' }), row({ name: 'j', section: 'judge' })] };
  const plan = voicingPlan([work({ candidateReplies: [] }), work({ name: 'j', candidateReplies: [] })], store);
  assert.deepEqual(plan.missing, []);
  assert.equal(plan.reuse.size, 2);
});

test('model-authored numerals make only that cached row a replaceable miss', () => {
  const invalid = row({ line: 'offer 2 options', signal: 'wants ２ choices' });
  const stable = row({ name: 'stable' });
  const plan = voicingPlan([work(), work({ name: 'stable' })], { rows: [invalid, stable] });
  assert.deepEqual(plan.missing, ['plan-first']);
  assert.deepEqual(plan.replace, ['plan-first']);
  assert.equal(plan.reuse.has('plan-first'), false);
  assert.equal(plan.reuse.get('stable'), stable);
});

// ── rememberVoiced — persist + prune ────────────────────────────────────────────────────────────

test('remember: adds new rows, prunes dead generations, and skips the write when nothing moved', () => {
  const file = join(dir, 'remember.json');
  const dead = row({ name: 'retired', bornAt: '2026-06-01T00:00:00Z' });
  writeVoiced({ rows: [row(), dead] }, 'claude-code', file);

  const live = [
    { name: 'plan-first', bornAt: GEN },
    { name: 'fresh', bornAt: GEN },
  ];
  rememberVoiced([row({ name: 'fresh', section: 'frame' })], live, 'claude-code', file);
  const after1 = readVoiced('claude-code', file);
  assert.deepEqual(after1.rows.map((r) => r.name).sort(), ['fresh', 'plan-first']);

  // an existing key is never overwritten (voiced once), a dead-generation new row is never kept,
  // and a no-op call leaves the file bytes untouched
  const bytes = readFileSync(file, 'utf8');
  rememberVoiced([row({ line: 'a re-rolled wording that must not land' }), dead], live, 'claude-code', file);
  assert.equal(readFileSync(file, 'utf8'), bytes);
  assert.equal(readVoiced('claude-code', file).rows.find((r) => r.name === 'plan-first')?.line, row().line);
});

test('remember: an explicitly invalid cache row is replaced in place, without moving its identity', () => {
  const file = join(dir, 'replace.json');
  writeVoiced({ rows: [row({ line: 'offer 2 options' })] }, 'claude-code', file);
  const replacement = row({ line: 'offer options before implementation', voicedAt: '2026-08-05T00:00:00Z' });
  rememberVoiced([replacement], [{ name: replacement.name, bornAt: replacement.bornAt }], 'claude-code', file, [replacement.name]);
  assert.deepEqual(readVoiced('claude-code', file).rows, [replacement]);
});

// ── the groups shelf — the fold's voice-once cache ──────────────────────────────────────────────

const group = (o: Partial<VoicedGroup> = {}): VoicedGroup => ({
  members: [
    { name: 'plan-first', bornAt: GEN },
    { name: 'probe-mechanism', bornAt: GEN },
  ],
  line: 'offer a plan before touching work',
  facets: ['a new multi-step task', 'a mechanism they doubt'],
  voicedAt: '2026-08-05T00:00:00Z',
  ...o,
});

test('groups: round-trip through write/read, malformed and misaligned groups dropped, rows untouched', () => {
  const file = join(dir, 'groups-roundtrip.json');
  const good = group();
  writeVoiced(
    {
      rows: [row()],
      groups: [
        good,
        { ...group(), facets: ['only one facet for two members'] }, // misaligned — dropped
        { ...group(), members: [{ name: 'solo', bornAt: GEN }] }, // one member is not a group — dropped
      ],
    },
    'claude-code',
    file,
  );
  const got = readVoiced('claude-code', file);
  assert.equal(got.rows.length, 1);
  assert.deepEqual(got.groups, [good]);
});

test('groupKeyOf: identity is the member SET — order never matters, membership always does', () => {
  const ab = group().members;
  const ba = [...group().members].reverse();
  assert.equal(groupKeyOf(ab), groupKeyOf(ba));
  assert.notEqual(groupKeyOf(ab), groupKeyOf([...ab, { name: 'third', bornAt: GEN }]));
});

test('rememberGroups: adds new folds, never re-bills a held one, prunes when a member generation dies', () => {
  const file = join(dir, 'groups-remember.json');
  const live = [
    { name: 'plan-first', bornAt: GEN },
    { name: 'probe-mechanism', bornAt: GEN },
  ];
  rememberGroups([group()], live, 'claude-code', file);
  assert.equal(readVoiced('claude-code', file).groups?.length, 1);

  // same member set again — the cached wording stands, the file does not move
  const bytes = readFileSync(file, 'utf8');
  rememberGroups([group({ line: 'a re-rolled wording that must not land' })], live, 'claude-code', file);
  assert.equal(readFileSync(file, 'utf8'), bytes);

  // a member's generation retiring prunes the fold — the next build re-plans from scratch
  rememberGroups([], [{ name: 'plan-first', bornAt: GEN }], 'claude-code', file);
  assert.deepEqual(readVoiced('claude-code', file).groups, []);
});

test('rememberVoiced preserves the groups shelf across a rows write — the sibling-key erasure trap', () => {
  const file = join(dir, 'groups-preserved.json');
  writeVoiced({ rows: [row()], groups: [group()] }, 'claude-code', file);
  const live = [
    { name: 'plan-first', bornAt: GEN },
    { name: 'probe-mechanism', bornAt: GEN },
    { name: 'fresh', bornAt: GEN },
  ];
  rememberVoiced([row({ name: 'fresh', section: 'frame' })], live, 'claude-code', file);
  const got = readVoiced('claude-code', file);
  assert.deepEqual(got.rows.map((r) => r.name).sort(), ['fresh', 'plan-first']);
  assert.equal(got.groups?.length, 1, 'the fold wording survived the rows write');
});

test('rememberVoiced prunes a group whose member is being replaced — its facet quoted dead wording', () => {
  const file = join(dir, 'groups-replaced-member.json');
  writeVoiced({ rows: [row({ line: 'offer 2 options' })], groups: [group()] }, 'claude-code', file);
  const live = [
    { name: 'plan-first', bornAt: GEN },
    { name: 'probe-mechanism', bornAt: GEN },
  ];
  const replacement = row({ line: 'offer options before implementation' });
  rememberVoiced([replacement], live, 'claude-code', file, [replacement.name]);
  const got = readVoiced('claude-code', file);
  assert.equal(got.rows.find((r) => r.name === 'plan-first')?.line, replacement.line);
  assert.deepEqual(got.groups, [], 'the fold re-words with its member');
});
