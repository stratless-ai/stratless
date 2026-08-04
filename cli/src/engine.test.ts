/**
 * ENGINE — the two guarantees that a silent failure would have broken, both found in a diligence
 * pass rather than by a test: the UPGRADE PATH, and REPLACE-not-append on a cold build.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PIPELINE, engineReady, loadEngine, outgrown, saveEngine, type EngineState } from './engine.js';
import { writeAssignments, loadAssignments } from './assign.js';
import type { Moment } from './moments.js';

const scratch = (name: string): string => join(mkdtempSync(join(tmpdir(), 'engine-')), name);

test('engineReady: a machine with categories but NO frozen model is NOT ready', () => {
  // THE UPGRADE CASE. A machine that ran a previous engine has categories.jsonl and no engine.json.
  // Branching cold-vs-steady on categories alone sent it down the steady path forever: nothing to
  // join against, nothing placed, silently never updating again. The worker asks THIS instead.
  const missing = scratch('engine.json');
  assert.equal(engineReady('claude-code', missing), false, 'no engine file at all');

  const empty = scratch('engine.json');
  saveEngine({ vocab: ['the'], centroids: [], labels: [], builtAt: 'x' }, 'claude-code', empty);
  assert.equal(engineReady('claude-code', empty), false, 'a model with no centres cannot place anything');

  const mismatched = scratch('engine.json');
  saveEngine({ vocab: ['the'], centroids: [[1, 0]], labels: [], builtAt: 'x' }, 'claude-code', mismatched);
  assert.equal(engineReady('claude-code', mismatched), false, 'centres without labels cannot name what a moment joined');

  const good = scratch('engine.json');
  saveEngine({ vocab: ['the'], centroids: [[1, 0]], labels: ['asks-for-a-plan'], builtAt: 'x', pipeline: PIPELINE }, 'claude-code', good);
  assert.equal(engineReady('claude-code', good), true);
});

test('engineReady: centroids from a DIFFERENT runtime are NOT ready — the versioned-rebuild case', () => {
  // THE RUNTIME CASE (0.6.0). Native vs WASM measured at cosine ~0.995 on identical texts: joining
  // new vectors against foreign centres would silently corrupt every count in the profile. A stale
  // or missing stamp routes the next consented update down the cold path — the announced rebuild.
  const pre060 = scratch('engine.json');
  saveEngine({ vocab: ['the'], centroids: [[1, 0]], labels: ['asks-for-a-plan'], builtAt: 'x' }, 'claude-code', pre060);
  assert.equal(engineReady('claude-code', pre060), false, 'a pre-0.6.0 file has no stamp: stale');

  const foreign = scratch('engine.json');
  saveEngine({ vocab: ['the'], centroids: [[1, 0]], labels: ['asks-for-a-plan'], builtAt: 'x', pipeline: 'some-future-runtime' }, 'claude-code', foreign);
  assert.equal(engineReady('claude-code', foreign), false, 'a different stamp is a different calculator: stale');
});

test('a corrupt engine file reads as not-ready rather than crashing a background worker', () => {
  const f = scratch('engine.json');
  writeFileSync(f, '{ not json');
  assert.equal(loadEngine('claude-code', f), undefined);
  assert.equal(engineReady('claude-code', f), false);
});

test('outgrown: the young trigger fires on doubled history, and only then', () => {
  // The pre-registered rule (parking-probe findings, 2026-08-04): base = supported-at-build,
  // now = supported today; fire ⇔ now >= 2·base AND now >= base + 3.
  const convs = (n: number): Moment[] =>
    Array.from({ length: n }, (_, i) => ({ session: `s${i}` }) as unknown as Moment);
  const state = (sessionsAtBuild: number | undefined, k: number): EngineState => ({
    vocab: [],
    centroids: Array.from({ length: k }, () => [1, 0]),
    labels: Array.from({ length: k }, (_, i) => `p${i}`),
    builtAt: 'x',
    pipeline: PIPELINE,
    ...(sessionsAtBuild != null ? { sessionsAtBuild } : {}),
  });

  // base 3 (built at 9 conversations): 15 convs support 5 — quiet; 18 support 6 — fires.
  assert.equal(outgrown(state(9, 3), convs(15)), false, 'not before the doubling');
  assert.equal(outgrown(state(9, 3), convs(18)), true, 'fires exactly at the doubling');
  // tiny pair, base 1: doubling alone would fire at supported 2 — the +3 floor holds it to 4.
  assert.equal(outgrown(state(3, 1), convs(6)), false, 'the tiny-pair floor');
  assert.equal(outgrown(state(3, 1), convs(12)), true);
  // mature pair, base 27: supported caps at K_MAX 30 < 54 — can never fire.
  assert.equal(outgrown(state(81, 27), convs(300)), false, 'maturity is what doubling runs out of');
  // the boundary: base 15 is the last base that can ever fire (2×15 = K_MAX).
  assert.equal(outgrown(state(45, 15), convs(90)), true);
  // legacy engine.json (no sessionsAtBuild): the built count is the only baseline it kept.
  assert.equal(outgrown(state(undefined, 3), convs(18)), true, 'legacy fallback');
  assert.equal(outgrown(state(undefined, 3), convs(15)), false);
  // THE PRUNING GUARD — why the base is sessions-at-build, never the built pile count: 4 piles
  // kept from history that supported 10 must NOT re-fire while the history still supports 10.
  assert.equal(outgrown(state(30, 4), convs(30)), false, 'admission pruning cannot cause a paid loop');
});

test('writeAssignments replace TRUNCATES — a cold build must not double every count', () => {
  // count.join() emits one row per RECORD, so a moment left holding an older row is counted twice
  // and every number in the profile inflates. This is what an upgrade would have done.
  const f = scratch('assignments.jsonl');
  writeAssignments([{ key: 'a', at: 't1', kinds: ['old-name'] }], 'claude-code', f);
  writeAssignments([{ key: 'a', at: 't2', kinds: ['new-name'] }], 'claude-code', f, 'replace');
  const rows = loadAssignments('claude-code', f);
  assert.equal(rows.length, 1, 'one moment, one record — not two');
  assert.deepEqual(rows[0].kinds, ['new-name'], 'the cold build establishes the whole set');
});

test('writeAssignments append is still append — growth adds to what is there', () => {
  const f = scratch('assignments.jsonl');
  writeAssignments([{ key: 'a', at: 't1', kinds: ['x'] }], 'claude-code', f);
  writeAssignments([{ key: 'b', at: 't2', kinds: ['y'] }], 'claude-code', f);
  assert.equal(loadAssignments('claude-code', f).length, 2);
});


test('per-record isolation: a codex cold build cannot touch the claude-code shelf', async (t) => {
  // THE REDESIGN'S CORE INVARIANT (2026-08-03): moments are never compared across records, and one
  // record's build can never write another's stores. The paths make it unrepresentable — this test
  // is the tripwire that the paths stay per-record.
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const home = mkdtempSync(join(tmpdir(), 'engine-isolation-'));
  const saved: Record<string, string | undefined> = {};
  const set = (k: string, v: string): void => {
    saved[k] = process.env[k];
    process.env[k] = v;
  };
  try {
    set('STRATLESS_RECORDS_DIR', join(home, 'records'));
    set('STRATLESS_MOMENTS', join(home, 'moments.jsonl'));
    set('STRATLESS_FAKE_EMBED', '1');
    // The fake brain: names every pile it is shown, deterministically.
    const bin = join(home, 'fake-claude');
    writeFileSync(
      bin,
      `#!/usr/bin/env node
const input = process.argv.slice(2).find((a) => a.includes('PILE ')) || '';
const ids = [...input.matchAll(/### PILE (\\d+)/g)].map((m) => Number(m[1]));
const groups = ids.map((id) => ({ name: 'codex-pattern-' + id, description: 'd' + id, quote: 'q', pile: id }));
process.stdout.write(JSON.stringify({ result: JSON.stringify({ groups }), is_error: false, total_cost_usd: 0.0001, usage: { input_tokens: 1, output_tokens: 1 } }));
`,
    );
    const { chmodSync } = await import('node:fs');
    chmodSync(bin, 0o755);
    set('STRATLESS_CLAUDE_BIN', bin);
    // The rule would now hand this codex-record build to the REAL codex binary on this machine's
    // PATH. The override exists for exactly this: pin the faked brain.
    set('STRATLESS_BRAIN', 'claude');

    // The claude-code shelf, already built — the state every second-assistant machine starts from.
    const ccDir = join(home, 'records', 'claude-code');
    mkdirSync(ccDir, { recursive: true });
    saveEngine({ vocab: ['the'], centroids: [[1, 0]], labels: ['claude-thing'], builtAt: 'x', pipeline: PIPELINE }, 'claude-code');
    writeFileSync(join(ccDir, 'categories.jsonl'), JSON.stringify({ event: 'born', name: 'claude-thing', description: 'd', at: 'x' }) + '\n');
    writeFileSync(join(ccDir, 'assignments.jsonl'), JSON.stringify({ key: 'k1', at: 'x', kinds: ['claude-thing'] }) + '\n');
    const before = Object.fromEntries(readdirSync(ccDir).map((f) => [f, readFileSync(join(ccDir, f), 'utf8')]));

    // A codex pile thick enough to cluster: 4 sessions × 8 moments.
    const lines: string[] = [];
    for (let sess = 0; sess < 4; sess++) {
      for (let i = 0; i < 8; i++) {
        lines.push(
          JSON.stringify({
            key: `cx-${sess}-${i}`,
            session: `codex:s${sess}`,
            record: 'codex',
            ts: `2026-07-${String(10 + sess).padStart(2, '0')}T1${i}:00:00Z`,
            pile: 'ordinary',
            reply: `please run the checks again variant ${i % 3}`,
            replyLen: 30,
          }),
        );
      }
    }
    writeFileSync(join(home, 'moments.jsonl'), lines.join('\n') + '\n');
    writeFileSync(join(home, 'moments.jsonl') + '.v', '4');

    const { coldBuild } = await import('./engine.js');
    const dr = await coldBuild('codex');
    t.diagnostic(`codex build: ${JSON.stringify(dr)}`);

    // The codex shelf exists and holds ONLY codex-derived state…
    assert.ok(existsSync(join(home, 'records', 'codex', 'engine.json')), 'codex earned its own frozen model');
    // …and the claude-code shelf is BYTE-IDENTICAL: not retired, not truncated, not touched.
    for (const [f, text] of Object.entries(before)) {
      assert.equal(readFileSync(join(ccDir, f), 'utf8'), text, `claude-code/${f} untouched by another record's cold build`);
    }

    // THE FROZEN BASELINES (0.11.0): the build stamps what its history supported (the young
    // trigger's base) and how snugly build-day moments sat (the mature trigger's yardstick).
    const cx = loadEngine('codex');
    assert.equal(cx?.sessionsAtBuild, 4, 'the raw conversation count at build');
    assert.equal(cx?.fit?.n, 32, 'fit measured over every build moment');
    assert.ok((cx?.fit?.median ?? -2) >= -1 && (cx?.fit?.median ?? 2) <= 1, 'fit is a cosine');

    // GROW keeps the fit ledger: one new moment joins, one summary line lands in fit.jsonl.
    writeFileSync(
      join(home, 'moments.jsonl'),
      readFileSync(join(home, 'moments.jsonl'), 'utf8') +
        JSON.stringify({ key: 'cx-new-1', session: 'codex:s9', record: 'codex', ts: '2026-07-20T10:00:00Z', pile: 'ordinary', reply: 'please run the checks again variant 1', replyLen: 30 }) + '\n',
    );
    const { grow } = await import('./engine.js');
    const gr = await grow('codex');
    assert.equal(gr.scored, 1, 'the new moment was placed');
    const fitLines = readFileSync(join(home, 'records', 'codex', 'fit.jsonl'), 'utf8').trim().split('\n');
    const lastFit = JSON.parse(fitLines[fitLines.length - 1]) as { n: number; median: number; p10: number };
    assert.equal(lastFit.n, 1, 'one joined moment, one measured fit');
    assert.ok(lastFit.median >= -1 && lastFit.median <= 1);
    // …and the other shelf is STILL untouched after growth.
    for (const [f, text] of Object.entries(before)) {
      assert.equal(readFileSync(join(ccDir, f), 'utf8'), text, `claude-code/${f} untouched by another record's growth`);
    }
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
