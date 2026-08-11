/**
 * Tests for THE REGISTRY.
 *
 * Two things matter here and the rest is bookkeeping: that an assistant is found by its history
 * being present rather than by configuration, and that "where is the history" is answered when
 * asked rather than frozen when the module loaded. The second one is why four other suites have to
 * fork a subprocess to read a fixture archive — these do it in-process, which is the point.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { allSessions, allTurns, anyArmed, detect, disarmEverywhere, firstDrift, records, registry, unloadEverywhere } from './registry.js';
import { profilePath, writeProfile } from '../../storage/profile.js';
import { isTypedMessage } from '../contracts.js';

/** A fixture HOME containing one Claude Code session. `os.homedir()` reads $HOME, so swapping it is
 *  all it takes now that roots are resolved at call time. */
function withHome<T>(fn: (home: string) => T): T {
  const home = mkdtempSync(join(tmpdir(), 'adapters-'));
  const saved = process.env.HOME;
  process.env.HOME = home;
  try {
    return fn(home);
  } finally {
    if (saved === undefined) delete process.env.HOME;
    else process.env.HOME = saved;
    rmSync(home, { recursive: true, force: true });
  }
}

function seed(home: string, records_: unknown[]): void {
  const proj = join(home, '.claude', 'projects', 'proj');
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, 'session-a.jsonl'), records_.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

const user = (text: string, uuid: string) =>
  ({ type: 'user', uuid, sessionId: 's1', timestamp: '2026-07-01T10:00:00.000Z', entrypoint: 'cli', message: { content: [{ type: 'text', text }] } });

test('the registry is compiled in, and every adapter declares what it can be trusted to claim', () => {
  assert.deepEqual(
    registry.map((a) => a.id),
    ['claude-code', 'codex'],
  );
  for (const a of registry) {
    assert.ok(a.record.tier, `${a.id} declares how much of a conversation its tool writes down`);
    assert.ok(a.displayName, `${a.id} names itself — messages interpolate this, never a literal`);
  }
});

test('adding an assistant costs one registry entry and nothing in the engine', () => {
  // The add-a-tool test, as an assertion rather than an intention. If a future Record forces a
  // change to exchange/moments/asks/mirror to be readable, the seam has leaked and this is where
  // that shows up: the engine only ever sees a RecordAdapter.
  const codex = registry.find((a) => a.id === 'codex');
  assert.ok(codex, 'the second Record is registered');
  const required = ['id', 'displayName', 'tier', 'detect', 'roots', 'sessions', 'turnsOf', 'health'];
  for (const key of required) assert.ok(key in codex.record, `it satisfies the contract: ${key}`);
  assert.equal(codex.record.titles, undefined, 'and declines the optional part honestly rather than faking it');
});

test('lifecycle state is registry-wide: stop disarms every assistant, not one named tool', () => {
  withHome(() => {
    registry[0].rhythm.arm();
    registry[1].rhythm.arm();
    assert.equal(anyArmed(), true, 'one live adapter makes the machine armed');
    const removed = disarmEverywhere().map(({ adapter }) => adapter.id);
    assert.ok(removed.includes('claude-code'));
    assert.ok(removed.includes('codex'));
    assert.equal(registry.every((adapter) => adapter.rhythm.state() === 'off'), true);
  });
});

test('a Codex-only machine is armed after its approval, and disarm reports shifted hook trust', () => {
  withHome((home) => {
    const codexHome = join(home, '.codex');
    const hooks = join(codexHome, 'hooks.json');
    const config = join(codexHome, 'config.toml');
    registry[1].rhythm.arm();
    assert.equal(anyArmed(), false, 'writing a Codex hook is not the person approving it');
    writeFileSync(config, `[hooks.state."${hooks}:session_end:0:0"]\ntrusted_hash = "sha256:fixture"\n`);
    assert.equal(anyArmed(), true, 'an approved Codex hook arms the machine without Claude Code');

    const doc = JSON.parse(readFileSync(hooks, 'utf8'));
    doc.hooks.SessionEnd.push({ description: 'theirs-later', hooks: [{ type: 'command', command: 'true' }] });
    writeFileSync(hooks, JSON.stringify(doc));

    const removed = disarmEverywhere();
    const codex = removed.find(({ adapter }) => adapter.id === 'codex');
    assert.deepEqual(codex?.warnings, [
      'Codex will ask you to re-approve 1 SessionEnd hook added after stratless because removing ours changed its position.',
    ]);
    assert.deepEqual(
      JSON.parse(readFileSync(hooks, 'utf8')).hooks.SessionEnd.map((group: { description: string }) => group.description),
      ['theirs-later'],
      "the person's hook survives even though its positional approval cannot",
    );
  });
});

test('an assistant is detected by its history being there — no configuration, no flag', () => {
  withHome((home) => {
    assert.deepEqual(detect(), [], 'an empty machine detects nothing rather than guessing');
    seed(home, [user('what I typed', 'u1')]);
    assert.deepEqual(
      detect().map((a) => a.id),
      ['claude-code'],
      'and finds it the moment a history exists',
    );
  });
});

test('roots are answered when asked, not frozen when the module loaded', () => {
  // The whole test is the swap: if roots had been captured at import, the second read would still
  // be looking at the first home — which is exactly the bug that forced subprocess fixtures.
  const first = withHome((home) => {
    seed(home, [user('from the first home', 'u1')]);
    return [...allTurns()].filter(isTypedMessage).map((t) => t.text);
  });
  const second = withHome((home) => {
    seed(home, [user('from the second home', 'u2')]);
    return [...allTurns()].filter(isTypedMessage).map((t) => t.text);
  });
  assert.deepEqual(first, ['from the first home']);
  assert.deepEqual(second, ['from the second home']);
});

test('sessions arrive batched per conversation, parsed by the record that understands them', () => {
  withHome((home) => {
    seed(home, [user('first', 'u1'), user('second', 'u2')]);
    const sessions = [...allSessions()];
    assert.equal(sessions.length, 1, 'one file, one session');
    assert.equal(sessions[0].turns.length, 2);
    assert.equal(records()[0].id, 'claude-code', 'and the record that read it is named');
  });
});

test('two assistants, one pile — each session read by the reader that understands it', () => {
  // The cross-tool promise, at its smallest: one person working in two tools produces one stream of
  // turns, with neither format's parser touching the other's files.
  withHome((home) => {
    seed(home, [user('what I typed to Claude', 'u1')]);
    const codexDir = join(home, '.codex', 'sessions', '2026', '07', '31');
    mkdirSync(codexDir, { recursive: true });
    const rollout = [
      { timestamp: '2026-07-31T10:00:00.000Z', type: 'session_meta', payload: { id: 'thread-1', cwd: '/w', source: 'cli', thread_source: 'user', history_mode: 'legacy', cli_version: '0.146.0' } },
      { timestamp: '2026-07-31T10:00:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'what I typed to Codex', images: [] } },
    ];
    writeFileSync(join(codexDir, 'rollout-x.jsonl'), rollout.map((r) => JSON.stringify(r)).join('\n') + '\n');

    assert.deepEqual(
      detect().map((a) => a.id),
      ['claude-code', 'codex'],
      'both are found by their history being present',
    );
    const texts = [...allTurns()].filter(isTypedMessage).map((t) => t.text).sort();
    assert.deepEqual(texts, ['what I typed to Claude', 'what I typed to Codex']);
    const sessions = [...allSessions()].map((s) => s.session);
    assert.ok(sessions.some((s) => s.startsWith('codex:')), 'and the Codex session is namespaced so ids can never collide');
  });
});

test('a healthy archive raises no drift; the canary speaks only when a format moves', () => {
  withHome((home) => {
    seed(home, [user('readable', 'u1')]);
    assert.equal(firstDrift(), undefined);
  });
});

test('an older install\'s loaded pointers are cleared from every tool, completely', () => {
  // THE OFF-RAMP. The profile went internal (2026-08-10): the legs' load() half seeds the state an
  // older install is actually in — a pointer in Claude Code, a copy in Codex — and unloadEverywhere
  // must take BOTH back out, or the sunset leaves a person's profile serving in a tool nobody
  // thought to check. Idempotence matters too: every refresh runs this.
  withHome((home) => {
    seed(home, [user('hello', 'u1')]);
    mkdirSync(join(home, '.codex', 'sessions'), { recursive: true });
    const savedMd = process.env.STRATLESS_CLAUDE_MD;
    const savedProfiles = process.env.STRATLESS_PROFILE_DIR;
    const savedCodex = process.env.CODEX_HOME;
    try {
      process.env.STRATLESS_CLAUDE_MD = join(home, '.claude', 'CLAUDE.md');
      process.env.STRATLESS_PROFILE_DIR = join(home, '.stratless');
      process.env.CODEX_HOME = join(home, '.codex');
      writeProfile('they ask for a plan before the work starts', profilePath('claude-code'));
      writeProfile('they run it and read the output first', profilePath('codex'));
      for (const a of detect()) a.load.load();
      assert.ok(/@.*HUMAN\.claude-code\.md/.test(readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8')), 'the older-install state this starts from');
      assert.ok(readFileSync(join(home, '.codex', 'AGENTS.md'), 'utf8').includes('they run it'), 'and the copy shape too');

      assert.deepEqual(unloadEverywhere().map((a) => a.id), ['claude-code', 'codex']);
      assert.equal(/@.*HUMAN\./.test(readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8')), false, 'the pointer is gone');
      assert.equal(readFileSync(join(home, '.codex', 'AGENTS.md'), 'utf8').includes('they run it'), false, 'the copy is gone');
      assert.deepEqual(unloadEverywhere(), [], 'a second pass finds nothing to remove and claims nothing');
    } finally {
      for (const [k, v] of [['STRATLESS_CLAUDE_MD', savedMd], ['STRATLESS_PROFILE_DIR', savedProfiles], ['CODEX_HOME', savedCodex]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

test('an assistant that is not on this machine is never written to', () => {
  // Detection is the whole guard here: creating a config file for a tool the person does not use
  // would be stratless leaving litter in a home directory to advertise itself.
  withHome((home) => {
    seed(home, [user('hello', 'u1')]);
    const saved = { md: process.env.STRATLESS_CLAUDE_MD, human: process.env.STRATLESS_HUMAN_MD, codex: process.env.CODEX_HOME };
    try {
      process.env.STRATLESS_CLAUDE_MD = join(home, '.claude', 'CLAUDE.md');
      process.env.STRATLESS_HUMAN_MD = join(home, '.stratless', 'HUMAN.md');
      process.env.CODEX_HOME = join(home, '.codex'); // no sessions dir → Codex is not here
      writeProfile('a profile');
      for (const a of detect()) a.load.load();
      assert.ok(existsSync(join(home, '.claude', 'CLAUDE.md')), 'the detected tool is written');
      assert.equal(existsSync(join(home, '.codex', 'AGENTS.md')), false, 'nothing is created for an absent tool');
    } finally {
      if (saved.md === undefined) delete process.env.STRATLESS_CLAUDE_MD; else process.env.STRATLESS_CLAUDE_MD = saved.md;
      if (saved.human === undefined) delete process.env.STRATLESS_HUMAN_MD; else process.env.STRATLESS_HUMAN_MD = saved.human;
      if (saved.codex === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = saved.codex;
    }
  });
});

test('one Record never reads another\'s slice of the vault', () => {
  // THE BUG THIS PINS: the vault root is Claude Code's own slice (flat filenames, historical), and
  // its reader walks recursively. Before slices existed, a second Record archiving under that root
  // had its rollouts picked up and parsed as Claude Code JSONL — silently, since a rollout is also
  // valid JSONL. Each Record now reads only its own, and the Claude walk refuses to descend.
  withHome((home) => {
    seed(home, [user('live claude', 'u1')]);
    const vault = join(home, '.stratless', 'archive');
    mkdirSync(join(vault, 'codex'), { recursive: true });
    // Claude's slice IS the root, flat — exactly what `archiveTranscripts` writes.
    writeFileSync(join(vault, 'proj__old.jsonl'), JSON.stringify(user('archived claude', 'u2')) + '\n');
    // Codex's slice is a named subdirectory under it.
    const rollout = [
      { timestamp: '2026-07-01T10:00:00.000Z', type: 'session_meta', payload: { id: 'cx1', cli_version: '0.146.0', source: 'cli', thread_source: 'user' } },
      { timestamp: '2026-07-01T10:00:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'archived codex' } },
    ];
    writeFileSync(join(vault, 'codex', 'rollout-x.jsonl'), rollout.map((r) => JSON.stringify(r)).join('\n') + '\n');

    const claudeRecord = registry.find((a) => a.id === 'claude-code')!.record;
    const claudeTexts = [...claudeRecord.sessions()].flatMap((s) => s.turns).filter(isTypedMessage).map((t) => t.text);
    assert.ok(claudeTexts.includes('archived claude'), "its own flat slice at the vault root is still read");
    assert.equal(claudeTexts.includes('archived codex'), false, "but the other Record's subdirectory is not");

    // And nothing is lost overall — the right reader picks it up.
    const all = [...allTurns()].filter(isTypedMessage).map((t) => t.text).sort();
    assert.deepEqual(all, ['archived claude', 'archived codex', 'live claude']);
  });
});

test('the archived copy of a live transcript is not counted twice', () => {
  // REGRESSION, caught by measurement rather than by a test: pointing the surfaces at every root
  // (live + vault) meant a person who had ever run `init` read their own history twice. Records with
  // a uuid dedup downstream; OLDER ONES CARRY NO UUID and slipped straight through — two live
  // records plus their two archived copies read as three messages.
  //
  // The live original wins. A vault copy survives only when its original is gone, which is the case
  // the vault exists for: a transcript Claude Code's reaper has already deleted.
  withHome((home) => {
    const body =
      [
        JSON.stringify(user('has a uuid', 'u1')),
        JSON.stringify({ ...user('no uuid at all', 'x'), uuid: undefined }),
      ].join('\n') + '\n';
    mkdirSync(join(home, '.claude', 'projects', 'proj'), { recursive: true });
    mkdirSync(join(home, '.stratless', 'archive'), { recursive: true });
    writeFileSync(join(home, '.claude', 'projects', 'proj', 's1.jsonl'), body);
    writeFileSync(join(home, '.stratless', 'archive', 'proj__s1.jsonl'), body); // what protect() writes

    const texts = [...allTurns()].filter(isTypedMessage).map((t) => t.text).sort();
    assert.deepEqual(texts, ['has a uuid', 'no uuid at all'], 'each conversation counted once');

    // ...and the copy is still the fallback when the reaper has taken the original.
    rmSync(join(home, '.claude', 'projects', 'proj', 's1.jsonl'));
    const afterReaping = [...allTurns()].filter(isTypedMessage).map((t) => t.text).sort();
    assert.deepEqual(afterReaping, ['has a uuid', 'no uuid at all'], 'the vault still has it');
  });
});

test('an assistant that is not on this machine is never armed or written to', () => {
  // The bug this pins: `init` used to be one Claude Code ceremony, so a Codex-only machine got a
  // ~/.claude/settings.json for an assistant it did not have, a Stop hook nothing would ever fire,
  // and a paragraph about a 30-day reaper belonging to a tool it had never installed.
  withHome((home) => {
    mkdirSync(join(home, '.codex', 'sessions'), { recursive: true });
    assert.deepEqual(detect().map((a) => a.id), ['codex'], 'only the one whose history is here');
    for (const a of detect()) a.rhythm.arm();
    assert.equal(existsSync(join(home, '.claude')), false, 'no config invented for an absent tool');
    assert.ok(existsSync(join(home, '.codex', 'hooks.json')), 'and the one that IS here got armed');
  });
});

test('our own vault existing is not evidence that Claude Code is installed', () => {
  // Found by running the real init twice: Codex's protect() creates ~/.stratless/archive, which is
  // one of the CLAUDE Record's roots — so a plain `roots().some(existsSync)` detected Claude Code on
  // a machine that had never had it, and the second `init` then wrote it a settings.json.
  withHome((home) => {
    mkdirSync(join(home, '.codex', 'sessions'), { recursive: true });
    mkdirSync(join(home, '.stratless', 'archive', 'codex'), { recursive: true });
    assert.deepEqual(detect().map((a) => a.id), ['codex'], 'a slice belonging to another Record proves nothing');

    // ...but a flat transcript at the vault root IS this Record's own history, and still counts
    // even once the tool itself has been uninstalled.
    writeFileSync(join(home, '.stratless', 'archive', 'proj__s1.jsonl'), JSON.stringify(user('archived', 'u1')) + '\n');
    assert.deepEqual(detect().map((a) => a.id), ['claude-code', 'codex']);
  });
});

test('the pack leg: each adapter names its own skill door, per HOME and CODEX_HOME', () => {
  withHome((home) => {
    const savedCodex = process.env.CODEX_HOME;
    try {
      process.env.CODEX_HOME = join(home, '.codex');
      const dirs = Object.fromEntries(registry.map((a) => [a.id, a.skillsDir()]));
      assert.equal(dirs['claude-code'], join(home, '.claude', 'skills'));
      assert.equal(dirs['codex'], join(home, '.codex', 'skills'));
    } finally {
      if (savedCodex === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = savedCodex;
    }
  });
});
