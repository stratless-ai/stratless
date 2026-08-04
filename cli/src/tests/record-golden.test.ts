/**
 * THE RECORD GOLDEN — one archive, every species, the WHOLE `Turn[]` pinned.
 *
 * reader.test.ts proves each hygiene rule ALONE: one archive per rule, one narrow assertion
 * (usually the surviving text). That is the right shape for "this rule works" and the wrong shape
 * for the question this file answers: **does the reader still hand the engine the same objects?**
 * A field silently dropped, renamed, or left unset passes every isolated test and changes every
 * number downstream — the counts, the piles, the profile — with nothing going red.
 *
 * So this is the net under any move of the reading layer: one archive carrying all the species at
 * once, deep-equal on the FULL turn list, plus a key-set assertion that fires the moment the `Turn`
 * contract gains or loses a field without this file being updated on purpose.
 *
 * Synthetic, not a captured transcript, for the same reason the rest of the suite is: the right
 * answer is known by construction, and a checked-in real sample cannot be published anyway. `tsc`
 * copies no fixtures into `dist/`, where these tests run — an on-disk sample could not be found
 * from the compiled test at all.
 *
 * The canary (`driftCheck`) is deliberately NOT re-tested here; reader.test.ts covers its four
 * cases, and both files move together whenever the module does.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTurns, readSessions, readTitles } from '../integrations/assistants/claude-code/record.js';
import { PASTE_BOUND, type Turn } from '../integrations/contracts.js';

const CWD = '/w/proj';
const BRANCH = 'main';
/** Minute `i` of one working morning — distinct per record, so order is visible in the assertion. */
const TS = (i: number) => `2026-07-01T10:${String(i).padStart(2, '0')}:00.000Z`;
/** Over PASTE_BOUND: a message, never a length statistic. */
const PASTE = 'x'.repeat(PASTE_BOUND + 1);

/** The fields every line of a real transcript carries; each record adds the case under test. */
const rec = (o: Record<string, unknown>) => ({ sessionId: 'sa', cwd: CWD, gitBranch: BRANCH, entrypoint: 'cli', ...o });

/** THE PERSON'S SESSION — every species that survives, and every one that must not. */
const SESSION_A = [
  rec({ uuid: 'a1', timestamp: TS(0), type: 'user', message: { content: [{ type: 'text', text: 'fix the flaky test' }] } }),
  // work performed: tools in order with duplicates, a NAMED and an unnamed spawn, a named and an
  // unnamed skill load. The unnamed ones count as runs (via `tools`) and are never labelled.
  rec({
    uuid: 'a2',
    timestamp: TS(1),
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'on it' },
        { type: 'tool_use', id: 'call-bash', name: 'Bash', input: { command: 'npm test' } },
        { type: 'tool_use', id: 'call-task', name: 'Task', input: { subagent_type: 'Explore' } },
        { type: 'tool_use', id: 'call-anon', name: 'Task', input: {} },
        { type: 'tool_use', id: 'call-skill', name: 'Skill', input: { skill: 'push' } },
        { type: 'tool_use', id: 'call-noskill', name: 'Skill', input: {} },
      ],
    },
  }),
  // the person refuses THAT call — the id resolves against the ledger the assistant turn fed
  rec({
    uuid: 'a3',
    timestamp: TS(2),
    type: 'user',
    toolDenialKind: 'user-rejected',
    message: { content: [{ type: 'tool_result', tool_use_id: 'call-bash', content: "The user doesn't want to proceed" }] },
  }),
  rec({ uuid: 'a4', timestamp: TS(3), type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } }),
  rec({ uuid: 'a5', timestamp: TS(4), type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } }),
  rec({ uuid: 'a6', timestamp: TS(5), type: 'user', message: { content: [{ type: 'text', text: '<system-reminder>never typed</system-reminder>what about the cache?' }] } }),
  // ── none of the next four is the person ──────────────────────────────────────────────────────
  rec({ uuid: 'a7', timestamp: TS(6), type: 'user', message: { content: [{ type: 'text', text: '<stratless-judge>\nPERSON ASKED: x' }] } }),
  rec({ uuid: 'a8', timestamp: TS(7), type: 'user', isSidechain: true, message: { content: [{ type: 'text', text: 'subagent chatter' }] } }),
  rec({ uuid: 'a9', timestamp: TS(8), type: 'user', isMeta: true, message: { content: [{ type: 'text', text: 'bookkeeping' }] } }),
  rec({ uuid: 'a10', timestamp: TS(9), type: 'assistant', message: { content: [{ type: 'text', text: '' }] } }),
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  rec({ uuid: 'a11', timestamp: TS(10), type: 'user', message: { content: [{ type: 'image' }, { type: 'text', text: '' }] } }),
  // a draft and the version actually sent share a parent: alternatives, not a sequence
  rec({ uuid: 'a12', timestamp: TS(11), parentUuid: 'a2', type: 'user', message: { content: [{ type: 'text', text: 'draft nobody sent' }] } }),
  rec({ uuid: 'a13', timestamp: TS(12), parentUuid: 'a2', type: 'user', message: { content: [{ type: 'text', text: 'the ask as submitted' }] } }),
  // an older transcript carries no uuid: kept, because a record we cannot dedup is still evidence
  rec({ timestamp: TS(13), type: 'user', message: { content: [{ type: 'text', text: 'no uuid on this one' }] } }),
  rec({ uuid: 'a15', timestamp: TS(14), type: 'user', message: { content: [{ type: 'text', text: PASTE }] } }),
  // the harness titles the session itself — its own record type, never a turn
  { type: 'ai-title', aiTitle: 'Fixing the flaky test', sessionId: 'sa' },
];

/** A SECOND SESSION, in an older file — and the first session's opener, replayed by a resume. */
const SESSION_B = [
  { type: 'user', uuid: 'a1', sessionId: 'sa', entrypoint: 'cli', timestamp: TS(0), cwd: CWD, gitBranch: BRANCH, message: { content: [{ type: 'text', text: 'fix the flaky test' }] } },
  // no cwd, no branch: absent stays absent, never a guess
  { type: 'user', uuid: 'b1', sessionId: 'sb', entrypoint: 'cli', timestamp: TS(20), message: { content: [{ type: 'text', text: 'different session, different work' }] } },
  // the SYSTEM blocked this one, and its id resolves to nothing — a denial we cannot attribute
  { type: 'user', uuid: 'b2', sessionId: 'sb', entrypoint: 'cli', timestamp: TS(21), toolDenialKind: 'automode-blocked', message: { content: [{ type: 'tool_result', tool_use_id: 'call-unknown' }] } },
];

/** OUR OWN BORROWED CALL — one `sdk-cli` record decides the whole file. */
const MACHINE = [
  { type: 'user', uuid: 'm1', sessionId: 'sm', entrypoint: 'sdk-cli', timestamp: TS(30), message: { content: [{ type: 'text', text: 'PERSON ASKED: what did they mean' }] } },
];

/** Mtimes are pinned: the walk orders by them, so an unpinned archive would order by write speed. */
function goldenArchive(): string {
  const dir = mkdtempSync(join(tmpdir(), 'record-golden-'));
  const write = (name: string, records: unknown[], mtime: number) => {
    const path = join(dir, name);
    writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n'); // trailing newline: a real file has one
    utimesSync(path, mtime, mtime);
  };
  write('session-a.jsonl', SESSION_A, 3000);
  write('session-b.jsonl', SESSION_B, 2000);
  write('machine.jsonl', MACHINE, 1000);
  return dir;
}

/** Both sides through JSON, so "absent" and "present but undefined" compare as what they are on
 *  disk: the moment store persists this projection, not the in-memory object. */
const plain = (x: unknown) => JSON.parse(JSON.stringify(x));

/** Defaults every turn carries; each expectation states only what makes it that turn. */
const turn = (o: Partial<Turn>) => ({
  session: 'sa',
  role: 'user',
  text: '',
  interrupted: false,
  pasted: false,
  cwd: CWD,
  gitBranch: BRANCH,
  images: 0,
  ...o,
});

/** THE GOLDEN: what those three files must read as, exactly, in this order. */
const EXPECTED = [
  turn({ uuid: 'a1', ts: TS(0), text: 'fix the flaky test' }),
  turn({
    uuid: 'a2',
    ts: TS(1),
    role: 'assistant',
    text: 'on it',
    tools: ['Bash', 'Task', 'Task', 'Skill', 'Skill'],
    delegations: ['Explore'],
    skills: ['push'],
    // The counts are NOT the array lengths: two spawns and two loads happened, one of each
    // unnamed. That gap is the whole reason the counts exist.
    delegationCount: 2,
    skillCount: 2,
  }),
  turn({ uuid: 'a3', ts: TS(2), denial: 'user-rejected', deniedTools: ['Bash'] }),
  turn({ uuid: 'a4', ts: TS(3), interrupted: true, interruptKind: 'tool-use' }),
  turn({ uuid: 'a5', ts: TS(4), interrupted: true, interruptKind: 'plain' }),
  turn({ uuid: 'a6', ts: TS(5), text: 'what about the cache?' }),
  turn({ uuid: 'a11', ts: TS(10), images: 1 }),
  turn({ uuid: 'a13', ts: TS(12), text: 'the ask as submitted' }), // the draft it superseded, in its place
  turn({ uuid: '', ts: TS(13), text: 'no uuid on this one' }),
  turn({ uuid: 'a15', ts: TS(14), text: PASTE, pasted: true }),
  turn({ uuid: 'b1', ts: TS(20), session: 'sb', text: 'different session, different work', cwd: undefined, gitBranch: undefined }),
  turn({ uuid: 'b2', ts: TS(21), session: 'sb', denial: 'automode-blocked', cwd: undefined, gitBranch: undefined }),
];

/** Every field the reader sets on a turn. Adding one is a contract change: state it here on purpose. */
const TURN_FIELDS = [
  'uuid',
  'session',
  'ts',
  'role',
  'text',
  'interrupted',
  'interruptKind',
  'pasted',
  'cwd',
  'gitBranch',
  'tools',
  'delegations',
  'skills',
  'delegationCount',
  'skillCount',
  'denial',
  'deniedTools',
  'images',
];

test('the golden: one archive of every species reads as exactly these turns', () => {
  const dir = goldenArchive();
  try {
    assert.deepEqual(plain([...readTurns([dir])]), plain(EXPECTED));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('the Turn contract carries exactly these fields — no more, no fewer', () => {
  const dir = goldenArchive();
  try {
    for (const t of readTurns([dir])) {
      assert.deepEqual(Object.keys(t).sort(), [...TURN_FIELDS].sort());
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('the golden reads as sessions too: newest file first, batched, titled', () => {
  const dir = goldenArchive();
  try {
    const sessions = [...readSessions([dir])];
    // machine.jsonl yields nothing, so it is never announced as a session at all
    assert.deepEqual(
      sessions.map((s) => s.session),
      ['sa', 'sb'],
    );
    assert.deepEqual(
      sessions.map((s) => s.turns.length),
      [10, 2],
    );
    assert.deepEqual(readTitles(dir), [{ aiTitle: 'Fixing the flaky test', sessionId: 'sa' }]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
