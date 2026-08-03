/**
 * Tests for THE CODEX RETURN.
 *
 * Two of these guard failures that are completely silent in the wild: writing into a file Codex
 * would not read (the override shadow), and leaving a stale copy behind (Codex takes a copy, not a
 * pointer, so the profile does not refresh itself the way Claude's import does).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { agentsMdPath, loadInto, loaded, unload } from './load-codex.js';
import { writeProfile } from './profile.js';

/** A machine with a Codex home and the CODEX PAIR's profile already built — the copy's source is
 *  `HUMAN.codex.md`, never a merged artifact (the per-record doctrine). */
function machine(fn: (home: string, profile: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'load-codex-'));
  const home = join(root, '.codex');
  const profile = join(root, 'HUMAN.codex.md');
  mkdirSync(home, { recursive: true });
  const savedHome = process.env.CODEX_HOME;
  const savedProfile = process.env.STRATLESS_PROFILE_DIR;
  process.env.CODEX_HOME = home;
  process.env.STRATLESS_PROFILE_DIR = root;
  try {
    fn(home, profile);
  } finally {
    if (savedHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = savedHome;
    if (savedProfile === undefined) delete process.env.STRATLESS_PROFILE_DIR;
    else process.env.STRATLESS_PROFILE_DIR = savedProfile;
    rmSync(root, { recursive: true, force: true });
  }
}

test('the profile is COPIED in, because Codex has no import to follow', () => {
  machine((home, profile) => {
    writeProfile('offer them a plan before building', profile);
    const written = loadInto();
    assert.equal(written, join(home, 'AGENTS.md'));
    const body = readFileSync(written!, 'utf8');
    assert.ok(body.includes('offer them a plan before building'), 'the words themselves are there, not a path to them');
    assert.equal(/@.*HUMAN\.md/.test(body), false, 'an import line would be inert text to Codex');
  });
});

test('an override file SHADOWS AGENTS.md, so that is where the profile goes', () => {
  // The silent failure this prevents: Codex reads AGENTS.override.md INSTEAD of AGENTS.md when one
  // exists. A perfect block in the wrong file is a profile nobody ever loads, with no error.
  machine((home, profile) => {
    writeFileSync(join(home, 'AGENTS.override.md'), '# my own instructions\n');
    writeProfile('the profile', profile);
    assert.equal(agentsMdPath(), join(home, 'AGENTS.override.md'), 'the live file is the one Codex would actually read');
    const written = loadInto();
    assert.equal(written, join(home, 'AGENTS.override.md'));
    assert.ok(readFileSync(written!, 'utf8').includes('# my own instructions'), "and the person's own words survive");
  });
});

test("the person's own instructions are never touched", () => {
  machine((home, profile) => {
    const agents = join(home, 'AGENTS.md');
    writeFileSync(agents, '# always use tabs\n# never force push\n');
    writeProfile('first profile', profile);
    loadInto();
    let body = readFileSync(agents, 'utf8');
    assert.ok(body.includes('# always use tabs') && body.includes('# never force push'));

    // A rebuild replaces only what is between the markers — the copy has to refresh, since nothing
    // about it updates itself.
    writeProfile('second profile', profile);
    loadInto();
    body = readFileSync(agents, 'utf8');
    assert.ok(body.includes('second profile'), 'the fresh profile is in');
    assert.equal(body.includes('first profile'), false, 'and the stale one is gone, not stacked beneath it');
    assert.equal(body.split('stratless:start').length - 1, 1, 'exactly one managed block, ever');
    assert.ok(body.includes('# always use tabs'), "the person's own content is still untouched");
  });
});

test('no profile yet means no block — not an empty one', () => {
  machine((home, profile) => {
    assert.equal(loadInto(), undefined, 'nothing to deliver, so nothing is written');
    assert.equal(loaded(), false);
    assert.equal(existsSync(join(home, 'AGENTS.md')), false, "and no file is created just to hold an empty block");
  });
});

test('unloading closes the gap and leaves everything else alone', () => {
  machine((home, profile) => {
    const agents = join(home, 'AGENTS.md');
    writeFileSync(agents, '# mine above\n');
    writeProfile('a profile', profile);
    loadInto();
    writeFileSync(agents, readFileSync(agents, 'utf8') + '\n# mine below\n');

    assert.equal(loaded(), true);
    assert.equal(unload(), true);
    const body = readFileSync(agents, 'utf8');
    assert.equal(loaded(), false, 'the profile is out');
    assert.ok(body.includes('# mine above') && body.includes('# mine below'), 'both halves of their file remain');
    assert.equal(body.includes('a profile'), false);
    assert.equal(unload(), false, 'and unloading twice is a safe no-op');
  });
});
