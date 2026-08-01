/**
 * Tests for THE CODEX RHYTHM.
 *
 * The important one is `arm appends`. Codex keys hook trust by POSITION, so inserting our group
 * ahead of the person's shifts their index and silently un-trusts automation they already approved.
 * That was measured on a real install (appending → "1 hook is new or changed"; inserting →
 * "2 hooks are new or changed") and it is invisible from inside our own process — nothing throws,
 * nothing warns, the person just finds Codex re-asking about hooks they had already said yes to.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { arm, disarm, groupsAfterOurs, hooksPath, readHooks, protect, state } from './rhythm-codex.js';

/** A machine with a Codex home, isolated on BOTH knobs — CODEX_HOME for the tool, HOME for our vault. */
function machine(fn: (home: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'rhythm-codex-'));
  const codex = join(root, '.codex');
  mkdirSync(codex, { recursive: true });
  const saved = { c: process.env.CODEX_HOME, h: process.env.HOME };
  process.env.CODEX_HOME = codex;
  process.env.HOME = root;
  try {
    fn(codex);
  } finally {
    if (saved.c === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = saved.c;
    if (saved.h === undefined) delete process.env.HOME;
    else process.env.HOME = saved.h;
    rmSync(root, { recursive: true, force: true });
  }
}

const groups = (codex: string): any[] => JSON.parse(readFileSync(join(codex, 'hooks.json'), 'utf8')).hooks.SessionEnd;

/** One of the person's own hooks, in Codex's real schema. */
const theirs = (name: string) => ({ description: name, hooks: [{ type: 'command', command: 'true' }] });

test('arm APPENDS — the person\'s existing hooks keep their index, and their trust', () => {
  machine((codex) => {
    writeFileSync(join(codex, 'hooks.json'), JSON.stringify({ hooks: { SessionEnd: [theirs('theirs-a'), theirs('theirs-b')] } }));
    arm();
    const g = groups(codex);
    assert.equal(g.length, 3);
    assert.deepEqual(g.map((x) => x.description), ['theirs-a', 'theirs-b', 'stratless'],
      'ours is LAST — anywhere else shifts their indices and un-trusts hooks they already approved');
  });
});

test('arm is idempotent, and never MOVES an entry that is already there', () => {
  // Re-running init must not reposition us: the index IS the trust key, so moving our own entry
  // would throw away an approval the person already gave us.
  machine((codex) => {
    arm();
    writeFileSync(
      join(codex, 'hooks.json'),
      JSON.stringify({ hooks: { SessionEnd: [...groups(codex), theirs('added-later')] } }),
    );
    arm();
    const g = groups(codex);
    assert.equal(g.filter((x) => x.description === 'stratless').length, 1, 'exactly one stratless group, ever');
    assert.equal(g[0].description, 'stratless', 'and it stayed at the index it was approved at');
  });
});

test('the hook detaches, because a blocking one hangs the session exit', () => {
  machine((codex) => {
    arm();
    const cmd = groups(codex)[0].hooks[0].command as string;
    assert.ok(cmd.trimEnd().endsWith('&'), 'spawn-and-detach: async hooks are unsupported and SessionEnd blocks exit');
    assert.ok(cmd.includes('stratless update'));
    assert.equal(/\d+\.\d+\.\d+/.test(cmd), false, 'no version in the command — trust is a hash of it, and a change re-prompts');
    assert.equal(cmd.includes(codex), false, 'and no absolute path, for the same reason');
  });
});

test('THE COMMAND STRING IS FROZEN — changing it re-prompts every existing user', () => {
  // This pins an exact string on purpose, and a failure here is a DESIGN QUESTION, not a broken
  // test. Codex stores hook trust as a hash over the hook's config, so editing this string
  // invalidates the grant on every machine that already approved it. Worse, it does so silently:
  // `state()` would keep reporting `armed` (the trust KEY still exists at our index) while Codex
  // skips the hook — the person believes their refresh is on when it is not.
  //
  // If it must ever change, that is a migration with its own messaging, not an edit: tell people
  // Codex will ask them to approve the refresh again. Do not change it to make this test pass.
  machine((codex) => {
    arm();
    assert.equal(
      groups(codex)[0].hooks[0].command,
      'stratless update >/dev/null 2>&1 &',
      'frozen — see the comment above before touching this',
    );
  });
});

test('an existing entry is left ALONE, edits and all — it is in the person\'s file', () => {
  // Two reasons, and they point the same way: rewriting it would invalidate a trust grant they
  // already gave, and if THEY were the one who edited it, overwriting is us fighting a person for
  // control of their own config. We add ours once and then leave the file alone.
  machine((codex) => {
    arm();
    const doc = JSON.parse(readFileSync(join(codex, 'hooks.json'), 'utf8'));
    doc.hooks.SessionEnd[0].hooks[0].command = 'stratless update # my own tweak &';
    writeFileSync(join(codex, 'hooks.json'), JSON.stringify(doc));
    arm();
    assert.equal(groups(codex)[0].hooks[0].command, 'stratless update # my own tweak &', 'their edit survives');
    assert.equal(groups(codex).length, 1, 'and no duplicate is added beside it');
  });
});

test('writing the hook is NOT arming it — that is the person\'s yes, in their own tool', () => {
  machine((codex) => {
    assert.equal(state(), 'off');
    assert.equal(arm(), 'awaiting-approval', 'the honest answer: written, and inert until they approve it');
    assert.equal(state(), 'awaiting-approval');

    // Codex records the grant in the person's config.toml, keyed by position.
    writeFileSync(
      join(codex, 'config.toml'),
      `[hooks.state."${join(codex, 'hooks.json')}:session_end:0:0"]\ntrusted_hash = "sha256:abc"\n`,
    );
    assert.equal(state(), 'armed', 'once they have said yes, it is live');
  });
});

test('a grant recorded for a DIFFERENT position does not count as ours', () => {
  machine((codex) => {
    writeFileSync(join(codex, 'hooks.json'), JSON.stringify({ hooks: { SessionEnd: [theirs('theirs')] } }));
    arm(); // ours lands at index 1
    writeFileSync(
      join(codex, 'config.toml'),
      `[hooks.state."${join(codex, 'hooks.json')}:session_end:0:0"]\ntrusted_hash = "sha256:abc"\n`,
    );
    assert.equal(state(), 'awaiting-approval', "their approval of group 0 is not an approval of ours at group 1");
  });
});

test('disarm removes only ours, and reports what removing it costs them', () => {
  machine((codex) => {
    writeFileSync(join(codex, 'hooks.json'), JSON.stringify({ hooks: { SessionEnd: [theirs('theirs')] } }));
    arm();
    assert.equal(groupsAfterOurs(), 0, 'we appended, so nothing follows us');

    // The person adds one of their own after ours — now removing ours would shift theirs.
    writeFileSync(join(codex, 'hooks.json'), JSON.stringify({ hooks: { SessionEnd: [...groups(codex), theirs('later')] } }));
    assert.equal(groupsAfterOurs(), 1, 'so `stop` can warn instead of letting Codex surprise them');

    assert.equal(disarm(), true);
    assert.deepEqual(groups(codex).map((x: any) => x.description), ['theirs', 'later'], 'both of theirs survive');
    assert.equal(disarm(), false, 'and a second disarm is a safe no-op');
  });
});

test('a hand-edited hooks.json is refused, never clobbered', () => {
  // The same doctrine as the Claude settings.json path: this file holds automation we did not write,
  // and overwriting one we cannot parse would destroy it.
  machine((codex) => {
    writeFileSync(join(codex, 'hooks.json'), '{ "hooks": { "SessionEnd": [] }, }'); // trailing comma
    assert.equal(readHooks().ok, false);
    assert.throws(() => arm(), /not valid JSON/);
    assert.equal(state(), 'off', 'and an unreadable file is never reported as armed');
    assert.equal(disarm(), false);
  });
});

test('arm creates the file when the person has no hooks at all', () => {
  machine((codex) => {
    assert.equal(existsSync(hooksPath()), false);
    arm();
    assert.deepEqual(groups(codex).map((x: any) => x.description), ['stratless']);
  });
});

test('protect keeps a copy, keyed to OUR vault, claiming no reaper it did not stop', () => {
  machine((codex) => {
    const day = join(codex, 'sessions', '2026', '07', '31');
    mkdirSync(day, { recursive: true });
    writeFileSync(join(day, 'rollout-a.jsonl'), '{"type":"session_meta"}\n');
    writeFileSync(join(day, 'notes.zst'), 'x'); // not a rollout we can read — must not be "kept"

    const r = protect();
    assert.equal(r.copied, 1);
    assert.equal(r.reaper, undefined, 'ABSENT, not a zeroed row — Codex has no deletion timer to stop');
    assert.ok(existsSync(join(process.env.HOME!, '.stratless', 'archive', 'codex', '2026', '07', '31', 'rollout-a.jsonl')),
      "the date nesting is preserved, so the copy reads back through the same walker");

    assert.deepEqual(protect(), { copied: 0, skipped: 1 }, 're-running is cheap — unchanged files are skipped');
  });
});
