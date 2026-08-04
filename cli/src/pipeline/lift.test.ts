/**
 * LIFT — the loop core's guarantees, pinned. The ones that carry it: the wording is voiced once
 * and printed verbatim forever (the wobble class is structurally impossible), a quiet window can
 * never read as healed (sample floors + the two-sided legs), re-homing is decisive or dormant —
 * never a guess — and THE PRINT-EQUIVALENCE ACCEPTANCE: the rebuild's print surface reproduces,
 * byte for byte, the strings the pre-rebuild machinery printed (frozen here as literals).
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, before, after } from 'node:test';

import {
  readLift,
  writeLift,
  rehome,
  nextPatchState,
  liftPrint,
  runLift,
  ASK_ALTITUDE_HOME,
  PRINT_CAP,
  type Patch,
  type PatchHistoryEntry,
} from './lift.js';

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'stratless-lift-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ── fixture builders ────────────────────────────────────────────────────────────────────────────

const patch = (o: Partial<Patch> = {}): Patch => ({
  id: '2026-07-01·plan',
  bornAt: '2026-07-01T00:00:00Z',
  mode: 1,
  form: 'sharpen',
  home: 'plan',
  pipeline: 'p1',
  centroid: [1, 0, 0],
  evidence: { reach: 209, slip: 25, stumbleSessions: 7 },
  baseline: { fail: 0.01 },
  wording: { text: 'when work is starting and I haven\'t set a plan yet, stop and plan first', x: 'x', doThis: 'do', y: 'y' },
  history: [],
  state: 'open',
  ...o,
});

const entry = (o: Partial<PatchHistoryEntry> = {}): PatchHistoryEntry => ({
  builtAt: '2026-07-20T00:00:00Z',
  fail: 0.01,
  sessions: 2,
  sample: 150,
  reach: 20,
  ...o,
});

const NOW = Date.parse('2026-07-28T00:00:00Z');

// ── the store ───────────────────────────────────────────────────────────────────────────────────

test('a corrupt or missing store degrades to empty — never a throw (the renders.json discipline)', () => {
  const p = join(dir, 'corrupt.json');
  writeFileSync(p, '{"patches": [{"id": 42}, "junk", {"id": "a", "home": "h", "mode": 3, "wording": {"text": "t"}}, {"id": "b", "home": "h", "mode": 1, "wording": {"text": "keeps"}, "state": "sideways"}]}');
  const store = readLift('claude-code', p);
  assert.equal(store.patches.length, 1, 'malformed records are dropped, valid ones survive');
  assert.equal(store.patches[0].state, 'open', 'an unknown state falls back to open, never crashes');
  assert.deepEqual(readLift('claude-code', join(dir, 'absent.json')), { patches: [] });
});

test('the wording survives the store verbatim — voiced once, never re-worded', () => {
  const p = join(dir, 'verbatim.json');
  const text = "when I've started without one, stop and set the bound for me";
  writeLift({ patches: [patch({ wording: { text } })] }, 'claude-code', p);
  const print = liftPrint('claude-code', p);
  assert.equal(print.clauses.get('plan')!.clause, text, 'the stored text is the printed text, byte for byte');
});

// ── re-homing (ATTRIBUTE's stability half) ──────────────────────────────────────────────────────

test('re-homing is decisive or dormant — never a guess', () => {
  const engine = { labels: ['plan-v2', 'other'], centroids: [[1, 0, 0], [0, 1, 0]] as ArrayLike<number>[], pipeline: 'p1' };
  assert.deepEqual(rehome(patch(), new Set(['plan']), engine), { home: 'plan' }, 'a live home is kept — no geometry touched');
  assert.deepEqual(rehome(patch(), new Set(['plan-v2', 'other']), engine), { home: 'plan-v2' }, 'a dead home re-homes on the decisive birth centroid');
  assert.deepEqual(rehome(patch({ pipeline: 'other-runtime' }), new Set(['plan-v2']), engine), { dormant: true }, 'cross-pipeline geometry is refused outright');
  const close = { labels: ['a', 'b'], centroids: [[1, 0.01, 0], [1, 0, 0.01]] as ArrayLike<number>[], pipeline: 'p1' };
  assert.deepEqual(rehome(patch(), new Set(['a', 'b']), close), { dormant: true }, 'no clear margin over the runner-up → dormant, not a coin flip');
  assert.deepEqual(rehome(patch({ mode: 2, home: ASK_ALTITUDE_HOME, centroid: undefined }), new Set(), undefined), { home: ASK_ALTITUDE_HOME }, 'the global home is not a map row and never goes dormant');
});

// ── the exits, mode 1 ───────────────────────────────────────────────────────────────────────────

test('mode 1 heals by graduation — the stumbles stopped while the reaching continued', () => {
  const p = patch({ history: [entry({ sessions: 0, reach: 15 }), entry({ builtAt: '2026-07-27T00:00:00Z', sessions: 0, reach: 12 })] });
  assert.deepEqual(nextPatchState(p, NOW), { state: 'healed', via: 'graduated' });
});

test('mode 1 heals by closing only when the assistant\'s supply HELD — slips falling with the doing is not closure', () => {
  const closing = patch({
    action: 'EnterPlanMode',
    baseline: { fail: 0.02 },
    history: [entry({ fail: 0.005, hold: 0.9, refusedRose: false }), entry({ builtAt: '2026-07-27T00:00:00Z', fail: 0.004, hold: 0.85, refusedRose: false })],
  });
  assert.deepEqual(nextPatchState(closing, NOW), { state: 'healed', via: 'closed' });
  const supplyFell = patch({
    action: 'EnterPlanMode',
    baseline: { fail: 0.02 },
    history: [entry({ fail: 0.005, hold: 0.3 }), entry({ builtAt: '2026-07-27T00:00:00Z', fail: 0.004, hold: 0.3 })],
  });
  assert.equal(nextPatchState(supplyFell, NOW).state, 'open', 'slips fell but so did the doing — that is not closure');
});

test('mode 1: a quiet window never heals, and a gap that never moved is wrong', () => {
  const quiet = patch({ history: [entry({ sessions: 0, sample: 20 }), entry({ builtAt: '2026-07-27T00:00:00Z', sessions: 0, sample: 20 })] });
  assert.equal(nextPatchState(quiet, NOW).state, 'open', 'twenty moments of quiet is not evidence of anything');
  const h: PatchHistoryEntry[] = [];
  for (let i = 0; i < 6; i++) h.push(entry({ builtAt: `2026-07-${String(10 + i * 3).padStart(2, '0')}T00:00:00Z`, fail: 0.05 }));
  const stuck = patch({ bornAt: '2026-05-01T00:00:00Z', baseline: { fail: 0.05 }, history: h });
  assert.equal(nextPatchState(stuck, NOW).state, 'wrong');
});

// ── the exits, mode 2 ───────────────────────────────────────────────────────────────────────────

const m2 = (o: Partial<Patch> = {}): Patch =>
  patch({ mode: 2, form: 'trigger', home: ASK_ALTITUDE_HOME, centroid: undefined, terms: ['caching'], baseline: { fail: 0.1, engage: 0.05 }, ...o });
const m2e = (o: Partial<PatchHistoryEntry> = {}): PatchHistoryEntry => ({ builtAt: '2026-07-20T00:00:00Z', fail: 0.1, sessions: 2, sample: 50, engage: 0.05, ...o });

test('mode 2 heals as learned — asks fade WHILE engagement holds (absorbed, not decayed)', () => {
  const p = m2({ history: [m2e({ fail: 0.04 }), m2e({ builtAt: '2026-07-27T00:00:00Z', fail: 0.03, engage: 0.04 })] });
  assert.deepEqual(nextPatchState(p, NOW), { state: 'healed', via: 'learned' });
});

test('mode 2: engagement collapse blocks learned, and no birth engagement means the exit cannot be evidenced', () => {
  const collapse = m2({ history: [m2e({ fail: 0.03, engage: 0.01 }), m2e({ builtAt: '2026-07-27T00:00:00Z', fail: 0.03, engage: 0.01 })] });
  assert.equal(nextPatchState(collapse, NOW).state, 'open');
  const noBirth = m2({ baseline: { fail: 0.1, engage: 0 }, history: [m2e({ fail: 0.02 }), m2e({ builtAt: '2026-07-27T00:00:00Z', fail: 0.02 })] });
  assert.equal(nextPatchState(noBirth, NOW).state, 'open', 'the exit that cannot be evidenced cannot fire');
});

test('mode 2: a quiet window never heals; an abandoned zone lapses neutrally; persistent asks are wrong', () => {
  const quiet = m2({ history: [m2e({ fail: 0, sample: 10 }), m2e({ builtAt: '2026-07-27T00:00:00Z', fail: 0, sample: 10 })] });
  assert.equal(nextPatchState(quiet, NOW).state, 'open');
  const gone = m2({
    bornAt: '2026-05-01T00:00:00Z',
    history: [m2e({ builtAt: '2026-05-20T00:00:00Z', fail: 0, engage: 0, sessions: 0 }), m2e({ builtAt: '2026-07-20T00:00:00Z', fail: 0, engage: 0, sessions: 0 })],
  });
  assert.equal(nextPatchState(gone, NOW).state, 'lapsed');
  const h: PatchHistoryEntry[] = [];
  for (let i = 0; i < 6; i++) h.push(m2e({ builtAt: `2026-07-${String(10 + i * 3).padStart(2, '0')}T00:00:00Z`, fail: 0.09 }));
  assert.equal(nextPatchState(m2({ bornAt: '2026-05-01T00:00:00Z', history: h }), NOW).state, 'wrong');
});

// ── the run (arithmetic paths only — minting is exercised end-to-end with the fake assistant) ───

test('the run is a no-op on nothing, and a dead home with no engine goes dormant', () => {
  const p1 = join(dir, 'noop.json');
  const r = runLift([], [], NOW, { file: p1, roots: [dir], record: 'claude-code', isPrimary: true });
  assert.deepEqual(r, { minted: 0, retired: 0, open: 0, changed: false });
  assert.deepEqual(readLift('claude-code', p1), { patches: [] }, 'the store was never created');

  const p2 = join(dir, 'dormant.json');
  writeLift({ patches: [patch({ pipeline: 'gone-runtime' })] }, 'claude-code', p2);
  const r2 = runLift([], [], NOW, { file: p2, roots: [dir], record: 'claude-code', isPrimary: true });
  assert.equal(readLift('claude-code', p2).patches[0].state, 'dormant', 'no live home, no honest geometry → dormant, kept silent');
  assert.equal(r2.changed, true, 'what prints moved');
});

// ── THE PRINT-EQUIVALENCE ACCEPTANCE ────────────────────────────────────────────────────────────

test('ACCEPTANCE: the print surface reproduces the pre-rebuild strings byte for byte', () => {
  const p = join(dir, 'equiv.json');
  writeLift(
    {
      patches: [
        patch({
          home: 'plan-mode-category',
          evidence: { reach: 209, slip: 25, stumbleSessions: 7 },
          wording: { text: 'when work is about to proceed without a plan laid out, stop and plan it out with me first' },
        }),
      ],
      meta: { asks: 563, sessions: 88, bounces: 52, specPhrases: [] },
      delegatedZones: 383,
    },
    'claude-code',
    p,
  );
  const print = liftPrint('claude-code', p);
  assert.deepEqual(print.clauses.get('plan-mode-category'), {
    clause: 'when work is about to proceed without a plan laid out, stop and plan it out with me first',
    slip: 25,
  });
  assert.deepEqual(print.keyLines, [
    "my questions circle a mechanism → drop a level: mechanism before number (563× across 88 conversations, 52 didn't land)",
    "where I never ask questions, I don't want lessons → just do the work, skip the teaching",
  ]);
});

test('clauses cap slip-heaviest; terminal and mode-2 patches never print as clauses', () => {
  const p = join(dir, 'cap.json');
  writeLift(
    {
      patches: [
        patch({ id: 'a', home: 'a', evidence: { slip: 1 } }),
        patch({ id: 'b', home: 'b', evidence: { slip: 9 } }),
        patch({ id: 'c', home: 'c', evidence: { slip: 5 } }),
        patch({ id: 'd', home: 'd', evidence: { slip: 3 } }),
        patch({ id: 'e', home: 'e', evidence: { slip: 99 }, state: 'healed' }),
        m2({ id: 'f' }),
      ],
    },
    'claude-code',
    p,
  );
  const print = liftPrint('claude-code', p);
  assert.equal(print.clauses.size, PRINT_CAP, 'capped');
  assert.deepEqual([...print.clauses.keys()], ['b', 'c', 'd'], 'slip-heaviest first; the healed patch is gone — the file thins');
  assert.ok(!print.clauses.has(ASK_ALTITUDE_HOME), 'mode 2 prints as key lines, never as a clause');
});
