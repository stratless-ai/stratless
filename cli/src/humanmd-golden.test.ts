/**
 * THE PROFILE GOLDEN — the whole pipeline, end to end, pinned to the byte.
 *
 * Every other suite tests one stage. This one runs the REAL cli as the after-session hook runs it —
 * a fixture HOME of synthetic transcripts, one detached `__worker`, the whole path from raw JSONL
 * to `HUMAN.md` on disk: moments → shape → embed → cluster → name → count → lift → write → load.
 * Then it compares the artifact against the text checked in below, byte for byte.
 *
 * WHY BYTES, AND WHY THIS IS NOT A THROWAWAY. The product's claim is that a profile does not wobble:
 * the same corpus must produce the same file, which is why the naming call's scope and merge verdicts
 * were deleted (measured swinging 18→0→0→0→10 piles across five identical builds) and why the voice
 * cache exists. Nothing enforced that end to end until this file. It is the wobble gate: the emitted
 * profile cannot change unless a person changes this expectation ON PURPOSE, in the same commit,
 * having looked at the diff.
 *
 * SO A RED RUN HERE IS A QUESTION, NOT A BUG: did the output change because you meant it to? If yes,
 * re-capture (the fixture is deterministic — run the worker on it, normalise, paste) and say so in
 * the commit. If no, something wobbles, and that is the failure this exists to catch.
 *
 * TWO LINES ARE NORMALISED, both by construction rather than by taste: the `# built` stamp is the
 * clock, and the managed-header version moves with every release. Everything else — the corpus
 * sentence and its date span, the counts, the trend words, the section routing, the shorthand row —
 * is derived from the fixture and must not move.
 *
 * The borrowed model is a fake binary that answers all three paid calls (name, voice, patch) from
 * the prompt it is shown, so the assertion covers our assembly, never the model's taste.
 */
import { strict as assert } from 'node:assert';
import { test, before, after } from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readProgress } from './progress.js';

const distDir = dirname(fileURLToPath(import.meta.url));
const cli = join(distDir, 'index.js');
let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'stratless-profile-golden-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

/** Fixed epoch: the corpus sentence prints the span, so the fixture's dates are part of the golden. */
const BASE = Date.parse('2026-06-01T09:00:00Z');

/** Six recurring asks — enough distinct phrasing for the clustering to find more than one crowd,
 *  cycled deterministically so the pile that each lands in never depends on run order. */
const ASKS = [
  'can we plan this out first before touching code',
  'is there a smaller slice we could ship instead',
  'show me the actual number, not a summary',
  'wait, why is that running again',
  'lets do the simplest thing that works here',
  'where are the docs for this bit',
];

/** One session: asks, answered turns that ran tools, a periodic interrupt and a periodic denial —
 *  so all three piles (ordinary, interrupt, decline) are populated and the counts have something to
 *  count. Every value derives from `seed` and `day`; nothing here is random. */
function transcript(seed: string, exchanges: number, day: number): string {
  const lines: string[] = [];
  let k = 0;
  const ts = () => new Date(BASE + day * 86_400_000 + k * 90_000).toISOString();
  const rec = (o: Record<string, unknown>) =>
    lines.push(
      JSON.stringify({ sessionId: `s-${seed}`, cwd: '/w/proj', gitBranch: 'main', entrypoint: 'cli', uuid: `${seed}-${k}`, timestamp: ts(), ...o }),
    ) && k++;
  for (let i = 0; i < exchanges; i++) {
    rec({ type: 'user', message: { content: [{ type: 'text', text: `${ASKS[i % ASKS.length]} (${seed}-${i})` }] } });
    rec({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: `here is what I found for ${seed}-${i}, in detail, with the tradeoffs laid out` },
          { type: 'tool_use', id: `c-${seed}-${i}`, name: i % 3 === 0 ? 'Read' : 'Bash', input: {} },
        ],
      },
    });
    if (i % 5 === 4) rec({ type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } });
    if (i % 7 === 6) rec({ type: 'user', toolDenialKind: 'user-rejected', message: { content: [{ type: 'tool_result', tool_use_id: `c-${seed}-${i}` }] } });
    rec({ type: 'user', message: { content: [{ type: 'text', text: `${ASKS[(i + 2) % ASKS.length]} — following up on ${seed}-${i}` }] } });
  }
  return `${lines.join('\n')}\n`;
}

/** The borrowed assistant, faked: it answers each of the three paid calls from the prompt it sees.
 *  Deterministic by construction — no wording of its own beyond a fixed template. */
function fakeAssistant(name: string): string {
  const path = join(dir, `fake-claude-${name}`);
  writeFileSync(
    path,
    `#!/usr/bin/env node
const input = process.argv.slice(2).join('\\n');
const out = (o) => process.stdout.write(JSON.stringify({ result: JSON.stringify(o), is_error: false, total_cost_usd: 0.0001, usage: { input_tokens: 1, output_tokens: 1 } }));
if (input.includes('### PILE ')) {
  const ids = [...input.matchAll(/### PILE (\\d+)/g)].map((m) => Number(m[1]));
  out({ groups: ids.map((id) => ({ name: 'pattern-' + id, description: 'does thing ' + id, quote: 'go', pile: id })) });
} else if (input.includes('CATEGORY: ')) {
  const names = [...input.matchAll(/CATEGORY: (\\S+)/g)].map((m) => m[1]);
  const SEC = ['frame', 'judge', 'register'];
  out({ picks: names.map((n, i) => ({ name: n, section: SEC[i % 3], line: 'offer the thing for ' + n, quote: 1, signal: 'wants the thing' })) });
} else if (input.includes('PATTERN')) {
  const names = [...input.matchAll(/PATTERN: (\\S+)/g)].map((m) => m[1]);
  out({ rules: names.map((n) => ({ name: n, x: 'started without one', do: 'set the bound first', y: 'wants a bound', clause: 'when I have started without one, set the bound for me' })) });
} else {
  out({});
}
`,
  );
  chmodSync(path, 0o755);
  return path;
}

/** A fixture HOME with eight sessions, every store redirected, the model faked, the pool off.
 *  `name` gives each test its OWN home: sharing one would let an earlier test's frozen engine and
 *  categories decide a later test's path, so "this is a cold build" would depend on test order. */
function fixture(name: string): Record<string, string> {
  const home = join(dir, name);
  const proj = join(home, '.claude', 'projects', 'proj');
  mkdirSync(proj, { recursive: true });
  for (let f = 0; f < 8; f++) {
    writeFileSync(join(proj, `session-${String(f).padStart(3, '0')}.jsonl`), transcript(`f${f}`, 10, f));
  }
  const st = join(home, '.stratless');
  mkdirSync(st, { recursive: true });
  return {
    HOME: home,
    STRATLESS_STATE: join(st, 'state.json'),
    STRATLESS_USAGE: join(st, 'usage.json'),
    STRATLESS_LOCK: join(st, 'lock'),
    STRATLESS_PROGRESS: join(st, 'progress.json'),
    STRATLESS_RENDERS: join(st, 'renders.json'),
    STRATLESS_BUILD: join(st, 'build.json'),
    STRATLESS_MOMENTS: join(st, 'moments.jsonl'),
    // Per-record stores land under the records dir; the fixture is single-record (claude-code),
    // which is exactly the native-user case the golden pins: one Record must produce byte-identical
    // output to the merged era.
    STRATLESS_RECORDS_DIR: join(st, 'records'),
    STRATLESS_PROFILE_DIR: st,
    STRATLESS_HUMAN_MD: join(home, '.claude', 'HUMAN.md'),
    STRATLESS_CLAUDE_MD: join(home, '.claude', 'CLAUDE.md'),
    STRATLESS_CLAUDE_BIN: fakeAssistant(name),
    STRATLESS_FAKE_EMBED: '1', // deterministic vectors, no 40MB download, no network
    STRATLESS_NO_POOL: '1', // sequential embedding: the pool is bit-identical but this needs no runtime
    STRATLESS_FLUSH: '1', // this run IS the consent — the worker may do the paid build
  };
}

/** Drop the clock, hold the version steady. Both move for reasons that are not the pipeline's. */
const normalize = (text: string): string =>
  text
    .split('\n')
    .filter((l) => !l.startsWith('# built '))
    .map((l) => l.replace(/^# \(managed by stratless [^:]*:/, '# (managed by stratless <version>:'))
    .join('\n');

/** THE GOLDEN. Re-capture only when the change is deliberate — see the header. */
const EXPECTED =
  [
    '# Who you are working with',
    '# (managed by stratless <version>: do not edit by hand; refreshed by `stratless update`)',
    '<!-- format: humanmd/v3 -->',
    '',
    "Derived from 8 of this person's own conversations with an AI assistant, 2026-06-01 to 2026-06-08. Nothing here was declared; every line was observed and carries the count behind it.",
    '',
    '**Read this as a prior, not a law.** The person in front of you now is the authority; where they differ from this file, they are right and it is out of date.',
    '',
    '## In the moment',
    '',
    'Their shorthand. Recognise these live; the detail is in the sections below.',
    '',
    '- "show me" → wants the thing',
    '',
    '## What to offer me before I ask',
    '',
    'Set these up or hand them over before I ask. Offering them unprompted is the point, not overstepping.',
    '',
    '- offer the thing for pattern-0 (32×, comes in bursts)',
    '',
    '## What to catch for me',
    '',
    'What I reliably challenge or refuse. Pre-empt these, so I do not have to catch them myself.',
    '',
    '- offer the thing for pattern-1 (128×, comes in bursts)',
  ].join('\n') + '\n';

test('the profile golden: one cold build over a fixture archive writes exactly this HUMAN.md', async () => {
  const env = fixture('cold');
  const worker = spawn(process.execPath, [cli, '__worker'], { env: { ...process.env, ...env }, stdio: 'ignore' });
  await new Promise((r) => worker.on('close', r));

  // A build that never finished would compare an absent file against the golden and fail with a
  // confusing message; say what actually went wrong instead.
  const progress = readProgress(env.STRATLESS_PROGRESS);
  assert.equal(progress?.phase, 'done', `the worker finished the build (progress: ${JSON.stringify(progress)})`);

  const written = readFileSync(join(env.STRATLESS_PROFILE_DIR, 'HUMAN.claude-code.md'), 'utf8');
  assert.equal(normalize(written), EXPECTED);
});

test('the second build over the same corpus writes the same file — the wobble check', async () => {
  const env = fixture('wobble'); // its own home: run 1 must genuinely be the cold path
  for (let run = 0; run < 2; run++) {
    const w = spawn(process.execPath, [cli, '__worker'], { env: { ...process.env, ...env }, stdio: 'ignore' });
    await new Promise((r) => w.on('close', r));
  }
  // The second run takes the STEADY path (categories and a frozen engine exist), so this also pins
  // that growing a pile re-stamps the same words rather than re-rolling them.
  assert.equal(normalize(readFileSync(join(env.STRATLESS_PROFILE_DIR, 'HUMAN.claude-code.md'), 'utf8')), EXPECTED);
});
