/**
 * Tests for THE CODEX RECORD.
 *
 * Every fixture below is shaped exactly like the real rollouts written by codex-cli 0.146.0 on
 * 2026-07-29, and every case is something that format actually does — the double-written message,
 * the refusal that is a tool result, the abort that means two different things, the fork that
 * rewrites timestamps. Two of them (the double write, the fork's rewritten timestamps) were found
 * by running this reader against real files and watching the counts come out wrong, which is why
 * they are pinned here rather than trusted to a comment.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join as pathJoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { driftCheck, readSessions, readTurns, roots, turnsOfFile, archiveSlice } from './record.js';
import { isTypedMessage } from '../../contracts.js';

let clock = 0;
const line = (type: string, payload: Record<string, unknown>) =>
  ({ timestamp: `2026-07-29T02:0${Math.floor(clock / 60) % 10}:${String(clock++ % 60).padStart(2, '0')}.000Z`, type, payload });

const meta = (o: Record<string, unknown> = {}) =>
  line('session_meta', {
    id: 'thread-1',
    session_id: 'thread-1',
    cwd: '/w/proj',
    originator: 'codex-tui',
    cli_version: '0.146.0',
    source: 'cli',
    thread_source: 'user',
    history_mode: 'legacy',
    git: { branch: 'main' },
    ...o,
  });

/** What the person typed — the EVENT. */
const typed = (message: string) => line('event_msg', { type: 'user_message', message, images: [], text_elements: [] });
/** The same message again, as the model sees it: the copy this reader must ignore. */
const echoed = (text: string) => line('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text }] });
const said = (message: string) => line('event_msg', { type: 'agent_message', message });
const call = (id: string, callId: string, name = 'exec') => line('response_item', { type: 'custom_tool_call', id, call_id: callId, name, input: '{}' });
const output = (id: string, callId: string, out: string, turnId?: string) =>
  line('response_item', {
    type: 'custom_tool_call_output',
    id,
    call_id: callId,
    output: out,
    ...(turnId ? { internal_chat_message_metadata_passthrough: { turn_id: turnId } } : {}),
  });
const aborted = (turnId: string, reason = 'interrupted') =>
  line('event_msg', { type: 'turn_aborted', turn_id: turnId, reason, started_at: 1, completed_at: 2, duration_ms: 1000 });

function archive(files: Record<string, unknown[]>): string {
  const dir = mkdtempSync(join(tmpdir(), 'codex-'));
  const sessions = join(dir, 'sessions', '2026', '07', '29');
  mkdirSync(sessions, { recursive: true });
  let t = 1000;
  for (const [name, records] of Object.entries(files)) {
    const p = join(sessions, name);
    writeFileSync(p, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    // newest-modified first is the walk's contract; later keys are written as NEWER
    utimesSync(p, (t += 100), t);
  }
  return dir;
}
const rootsOf = (dir: string) => [join(dir, 'sessions')];
const typedTexts = (dir: string) => [...readTurns(rootsOf(dir))].filter(isTypedMessage).map((t) => t.text);

test('a message written twice is one message — the event, never the copy sent to the model', () => {
  // The single most consequential rule in this reader: reading both would double every count in
  // the profile, and reading the model-facing copy would count an injected <environment_context>
  // block as something the person said.
  const dir = archive({
    'a.jsonl': [
      meta(),
      echoed('<environment_context>\n  <cwd>/w/proj</cwd>\n</environment_context>'),
      typed('fix the flaky test'),
      echoed('fix the flaky test'),
      said('on it'),
    ],
  });
  assert.deepEqual(typedTexts(dir), ['fix the flaky test']);
  rmSync(dir, { recursive: true });
});

test('a refusal is a tool result, and it names the call it refused', () => {
  const dir = archive({
    'a.jsonl': [meta(), typed('delete the test file'), call('ctc_1', 'call_1', 'exec'), output('ctco_1', 'call_1', 'aborted by user after 1.9s', 'turn-1')],
  });
  const denied = [...readTurns(rootsOf(dir))].filter((t) => t.denial);
  assert.equal(denied.length, 1);
  assert.equal(denied[0].denial, 'user-rejected');
  assert.deepEqual(denied[0].deniedTools, ['exec'], 'attributable — which call was refused, not merely that one was');
  rmSync(dir, { recursive: true });
});

test('the upstream dialect is read too — the shipped build and the source say different words', () => {
  // 0.146.0 writes "aborted by user"; the repo at main writes "rejected by user". A reader that
  // knew only the one it was built against would silently stop seeing refusals after an update.
  const dir = archive({
    'a.jsonl': [meta(), call('ctc_1', 'call_1'), output('ctco_1', 'call_1', 'rejected by user', 'turn-1')],
  });
  assert.equal([...readTurns(rootsOf(dir))].filter((t) => t.denial === 'user-rejected').length, 1);
  rmSync(dir, { recursive: true });
});

test('"rejected" inside ordinary output is not a refusal — whole body only', () => {
  // Measured on the reference corpus: the word appeared 7 times inside documentation echoed
  // through tool output in ten minutes of work. A substring match would have invented 7 refusals.
  const dir = archive({
    'a.jsonl': [meta(), call('ctc_1', 'call_1'), output('ctco_1', 'call_1', 'the request was rejected by the upstream API, retrying', 'turn-1')],
  });
  assert.equal([...readTurns(rootsOf(dir))].filter((t) => t.denial).length, 0);
  rmSync(dir, { recursive: true });
});

test('a guardian saying no is not the person saying no', () => {
  const dir = archive({
    'a.jsonl': [meta(), call('ctc_1', 'call_1'), output('ctco_1', 'call_1', 'rejected by configuration', 'turn-1')],
  });
  const d = [...readTurns(rootsOf(dir))].filter((t) => t.denial);
  assert.equal(d[0].denial, 'automode-blocked', 'a policy blocking a tool is not friction the person felt');
  rmSync(dir, { recursive: true });
});

test('an abort in a turn that refused something is a permission stop; alone it is a course correction', () => {
  // Codex writes ONE event for both. The turn_id join is the only thing that tells them apart, and
  // summing them is exactly how a wrong friction figure gets published.
  const dir = archive({
    'a.jsonl': [
      meta(),
      call('ctc_1', 'call_1'),
      output('ctco_1', 'call_1', 'aborted by user after 2.0s', 'turn-declined'),
      aborted('turn-declined'),
      typed('actually stop'),
      aborted('turn-plain'),
    ],
  });
  const kinds = [...readTurns(rootsOf(dir))].filter((t) => t.interrupted).map((t) => t.interruptKind);
  assert.deepEqual(kinds, ['tool-use', 'plain']);
  rmSync(dir, { recursive: true });
});

// ── parity: what a Codex user's mirror shows, versus a Claude user's ─────────────────────────────

/** A call whose input declares what it invoked, the way the real ones do. */
const invoking = (id: string, callId: string, input: string) =>
  line('response_item', { type: 'custom_tool_call', id, call_id: callId, name: 'exec', input });
const context = (approval: string) => line('turn_context', { approval_policy: approval, cwd: '/w/proj', model: 'gpt-5' });

test('a call is named by what it invoked, which the call itself declares', () => {
  // Codex names EVERY call `exec`, so a mix read from the name alone is one bucket at 100% — a row
  // that says nothing where a Claude user's reads "Bash · Edit · Read". The detail sits one level
  // down, in Codex's own API names, so reading it out reports a recorded fact.
  const dir = archive({
    'a.jsonl': [
      meta(),
      invoking('ctc_1', 'call_1', 'const r = await tools.exec_command({"cmd":"node test.js"})'),
      invoking('ctc_2', 'call_2', 'const patch = "*** Begin Patch\\n*** Update File: /w/proj/greet.js"'),
      invoking('ctc_3', 'call_3', 'const r = await tools.web__run({search_query:[{q:"docs"}]})'),
      invoking('ctc_4', 'call_4', 'something this reader has never seen'),
    ],
  });
  assert.deepEqual(
    [...readTurns(rootsOf(dir))].flatMap((t) => t.tools ?? []),
    ['exec_command', 'apply_patch', 'web__run', 'exec'],
    'and an unrecognised call keeps its own name rather than a label we invented for it',
  );
  rmSync(dir, { recursive: true });
});

test('a skill load is recorded as a path, and read back as a skill', () => {
  // Codex has skills but no Skill tool: loading one means READING skills/<name>/SKILL.md, so the
  // fact is in the record and the name is in the path.
  const dir = archive({
    'a.jsonl': [
      meta(),
      invoking('ctc_1', 'call_1', 'const r = await tools.exec_command({"cmd":"cat /Users/x/.codex/skills/wrangler/SKILL.md"})'),
      invoking('ctc_2', 'call_2', 'const r = await tools.exec_command({"cmd":"cat /Users/x/.codex/skills/.system/openai-docs/SKILL.md"})'),
      invoking('ctc_3', 'call_3', 'const r = await tools.exec_command({"cmd":"ls /Users/x/.codex/skills"})'),
    ],
  });
  const skills = [...readTurns(rootsOf(dir))].flatMap((t) => t.skills ?? []);
  assert.deepEqual(skills, ['wrangler', '.system/openai-docs'], 'where a built-in came from stays part of its name');
  rmSync(dir, { recursive: true });
});

test('listing the skills directory is not loading a skill', () => {
  const dir = archive({
    'a.jsonl': [meta(), invoking('ctc_1', 'call_1', 'const r = await tools.exec_command({"cmd":"ls ~/.codex/skills && grep -r foo ~/.codex/skills"})')],
  });
  assert.deepEqual([...readTurns(rootsOf(dir))].flatMap((t) => t.skills ?? []), [], 'reading the SKILL.md is the load; mentioning the folder is not');
  rmSync(dir, { recursive: true });
});

test('under a policy that never prompts, a stop is a course correction and not a refusal', () => {
  // The policy lever. Codex writes the same record for "rejected the prompt" and "stopped the
  // running command" — but under `never` the person was never asked, so only the second is
  // possible. Calling it a decline would put a permission event in the profile of someone who was
  // never shown a permission prompt.
  const dir = archive({
    'a.jsonl': [meta(), context('never'), invoking('ctc_1', 'call_1', 'const r = await tools.exec_command({"cmd":"sleep 15"})'), output('ctco_1', 'call_1', 'aborted by user after 14.0s', 'turn-1')],
  });
  const turns = [...readTurns(rootsOf(dir))];
  assert.equal(turns.filter((t) => t.denial).length, 0, 'no refusal, because none was possible');
  assert.equal(turns.filter((t) => t.interrupted && t.interruptKind === 'plain').length, 1, 'it was a stop mid-flight');
  rmSync(dir, { recursive: true });
});

test('under a prompting policy the same record stays a refusal — the broader, honest reading', () => {
  const dir = archive({
    'a.jsonl': [meta(), context('untrusted'), invoking('ctc_1', 'call_1', 'const r = await tools.exec_command({"cmd":"rm -rf ."})'), output('ctco_1', 'call_1', 'aborted by user after 2.0s', 'turn-1')],
  });
  const denied = [...readTurns(rootsOf(dir))].filter((t) => t.denial);
  assert.equal(denied.length, 1, 'ambiguous, so it keeps the reading that assumes they were asked');
  assert.deepEqual(denied[0].deniedTools, ['exec_command']);
  rmSync(dir, { recursive: true });
});

test('an abort the person did not cause is not counted as theirs', () => {
  const dir = archive({ 'a.jsonl': [meta(), typed('go'), aborted('turn-1', 'replaced'), aborted('turn-2', 'budget_limited')] });
  assert.equal([...readTurns(rootsOf(dir))].filter((t) => t.interrupted).length, 0);
  rmSync(dir, { recursive: true });
});

test('a fork copies its parent with NEW timestamps — the same work is read once', () => {
  // The bug this pins: identity cannot be the line, because the envelope's timestamp is rewritten
  // on copy. Found by running the reader over real forked rollouts and watching declines double.
  const parent = [meta(), typed('first ask'), call('ctc_1', 'call_1'), output('ctco_1', 'call_1', 'aborted by user after 1.0s', 't1'), aborted('t1')];
  const copied = parent.slice(1).map((r) => ({ ...r, timestamp: '2026-07-29T03:00:00.000Z' })); // fork rewrites these
  const dir = archive({
    'parent.jsonl': parent,
    'fork.jsonl': [meta({ id: 'thread-2', forked_from_id: 'thread-1' }), meta(), ...copied, typed('only in the fork')],
  });
  const turns = [...readTurns(rootsOf(dir))];
  assert.deepEqual(turns.filter(isTypedMessage).map((t) => t.text), ['first ask', 'only in the fork'], 'the shared history once, the fork-only message once');
  assert.equal(turns.filter((t) => t.denial).length, 1, 'and the refusal is not counted twice');
  rmSync(dir, { recursive: true });
});

test('the same question asked twice is two messages, not a duplicate', () => {
  // The other half of fork dedup: identity is (lineage, position, content), so a person who really
  // repeats themselves keeps both messages. Keying on content alone would delete one.
  const dir = archive({ 'a.jsonl': [meta(), typed('run the tests'), said('ok'), typed('run the tests')] });
  assert.deepEqual(typedTexts(dir), ['run the tests', 'run the tests']);
  rmSync(dir, { recursive: true });
});

test('our own borrowed calls and subagent threads are not the person', () => {
  const dir = archive({
    'exec.jsonl': [meta({ id: 'x', source: 'exec' }), typed('PERSON ASKED: what did they mean')],
    'sub.jsonl': [meta({ id: 'y', thread_source: 'subagent' }), typed('subagent chatter')],
    'mine.jsonl': [meta({ id: 'z' }), typed('what I really typed')],
  });
  assert.deepEqual(typedTexts(dir), ['what I really typed']);
  rmSync(dir, { recursive: true });
});

test('sessions are namespaced, so two tools can never collide on an id', () => {
  const dir = archive({ 'a.jsonl': [meta(), typed('hello')] });
  assert.equal([...readSessions(rootsOf(dir))][0].session, 'codex:thread-1');
  rmSync(dir, { recursive: true });
});

test('a history layout this reader has never seen is refused, not guessed at', () => {
  const dir = archive({ 'a.jsonl': [meta({ history_mode: 'something-new' }), typed('hello')] });
  assert.deepEqual([...readTurns(rootsOf(dir))], [], 'silence beats reading an unknown layout as if it were understood');
  rmSync(dir, { recursive: true });
});

test('the canary speaks when the history is there but unreadable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-zst-'));
  const sessions = join(dir, 'sessions');
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(sessions, 'rollout-old.jsonl.zst'), 'compressed bytes');
  const report = driftCheck(rootsOf(dir));
  assert.equal(report.ok, false);
  assert.match(report.reason ?? '', /compressed/i, 'says the history exists and cannot be opened — never "no conversations"');
  rmSync(dir, { recursive: true });
});

test('a healthy archive raises no drift, and a thin one is a fresh start rather than a failure', () => {
  const dir = archive({ 'a.jsonl': [meta(), typed('readable')] });
  assert.equal(driftCheck(rootsOf(dir)).ok, true);
  rmSync(dir, { recursive: true });
});

test("the read has two halves — the tool's history, and our own slice of the vault", () => {
  // CODEX_HOME moves Codex's half; HOME moves ours. Deliberately NOT the same knob: the vault is
  // stratless's, not the tool's, so it survives Codex being moved or uninstalled. A fixture has to
  // set both to be fully isolated.
  const savedCodex = process.env.CODEX_HOME;
  const savedHome = process.env.HOME;
  process.env.CODEX_HOME = '/nowhere/at/all';
  process.env.HOME = '/somewhere/else';
  try {
    assert.deepEqual(roots(), ['/nowhere/at/all/sessions', '/somewhere/else/.stratless/archive/codex']);
    assert.ok(
      archiveSlice().endsWith('/archive/codex'),
      'our slice is a NAMED SUBDIRECTORY, never the vault root — the root is Claude Code\'s flat slice, and archiving into it would get these rollouts read back as Claude JSONL',
    );
  } finally {
    if (savedCodex === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = savedCodex;
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
  }
});

test('the reader streams: a rollout is never held in memory whole', () => {
  // Rollouts reach gigabytes in the wild. This asserts the mechanism rather than the intent —
  // readFileSync would show up here, and a future "simplification" back to slurping would fail.
  const src = readFileSync(pathJoin(process.cwd(), 'src', 'integrations', 'assistants', 'codex', 'record.ts'), 'utf8');
  assert.equal(/readFileSync/.test(src), false, 'no whole-file read anywhere in the Codex reader');
  assert.equal(/readSync\(/.test(src), true, 'it reads in bounded chunks');
});

test('one enormous line is skipped without taking the file down with it', () => {
  const dir = archive({ 'a.jsonl': [meta(), typed('before')] });
  const p = join(dir, 'sessions', '2026', '07', '29', 'a.jsonl');
  appendFileSync(p, JSON.stringify({ timestamp: '2026-07-29T02:30:00.000Z', type: 'event_msg', payload: { type: 'agent_message', message: 'x'.repeat(5 * 1024 * 1024) } }) + '\n');
  appendFileSync(p, JSON.stringify(typed('after')) + '\n');
  const texts = [...turnsOfFile(p)].filter(isTypedMessage).map((t) => t.text);
  assert.deepEqual(texts, ['before', 'after'], 'the monster line is dropped and reading continues');
  rmSync(dir, { recursive: true });
});

test('the profile we load into AGENTS.md never comes back as the person talking', () => {
  // MEASURED on a real interactive session (2026-08-01), not imagined: Codex copies the whole of
  // AGENTS.md into the rollout as `response_item` with role `user` — and AGENTS.md is exactly where
  // this tool writes the person's profile. If that record were ever read, each rebuild would be
  // partly reading its own output, and the profile would confirm itself a little harder every time.
  //
  // Two things stop it and both are asserted here: the model-facing channel is ignored outright,
  // and a user EVENT carrying our managed block is refused even so.
  const block = '<!-- stratless:start -->\n# Who you are working with\nthey ask for a plan first. (11x)\n<!-- stratless:end -->';
  const dir = archive({
    'a.jsonl': [meta(), echoed(block), typed(block), typed('reply with only the word banana')],
  });
  assert.deepEqual(typedTexts(dir), ['reply with only the word banana'], 'only what the person actually typed');
  rmSync(dir, { recursive: true });
});
