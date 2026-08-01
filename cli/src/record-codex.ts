/**
 * THE CODEX RECORD — OpenAI Codex CLI's rollouts, and what counts as the person talking in them.
 *
 * The second Record (see `seam.ts` for the contract, `adapters.ts` for the registry). It inherits
 * the LESSON of the Claude reader — that most of a transcript was never typed by anyone — but none
 * of its answers, because Codex writes things down its own way. Everything below was verified
 * against real rollouts written by codex-cli 0.146.0 on 2026-07-29, not from documentation.
 *
 * FOUR THINGS THIS FORMAT DOES THAT CLAUDE'S DOES NOT:
 *
 *  1. IT WRITES EVERY MESSAGE TWICE. A typed message appears as an `event_msg.user_message` AND
 *     again as a `response_item.message` with role user — the second being the copy sent to the
 *     model, which also carries an injected `<environment_context>` block the person never typed.
 *     Reading both would double every count in the profile; reading the model-facing one would
 *     count the harness's own preamble as something the person said. So the events are the source
 *     of truth here and `response_item.message` is ignored entirely. Same for the assistant side.
 *
 *     THAT CHOICE TURNS OUT TO BE LOAD-BEARING FOR A SECOND REASON, measured 2026-08-01: the
 *     model-facing copy also carries the whole of `AGENTS.md` — which is where OUR OWN PROFILE is
 *     written. Verified by putting a sentinel string in a profile block and reading the rollout of
 *     a real interactive session: it appears at `response_item` / role `user`, looking exactly like
 *     something the person typed. Reading that record would feed the profile back into the pile it
 *     was built from, and every rebuild would confirm itself a little harder. The event channel is
 *     clean. `looksLikeOurs` below is the belt to that pair of braces.
 *
 *  2. A REFUSAL IS A TOOL RESULT, not a record of its own. Declining a command writes
 *     `custom_tool_call_output` whose whole body is "aborted by user after 1.9s", carrying the
 *     `call_id` of the call it refused — so the refusal is attributable, which is what lets a
 *     profile say WHAT was declined rather than only that something was.
 *
 *  3. DECLINE AND INTERRUPT SHARE AN EVENT. Refusing a call ALSO emits `turn_aborted`, exactly as
 *     a spontaneous Escape does. They are told apart by `turn_id`: an abort whose turn also holds
 *     a refused call is the tail of a permission flow ('tool-use'); an abort with no refusal in
 *     its turn is a genuine course correction ('plain'). Claude draws that same line with two
 *     different message strings; here it is a join, and collapsing it would inflate the one number
 *     the person is shown.
 *
 *  4. RECORDS HAVE NO IDS, and `codex fork` copies its parent's whole history into a new file with
 *     REWRITTEN timestamps — so identity has to be reconstructed. See `eventKey`. Consequence worth
 *     knowing: the fork is the newer file, so it is read first and the shared history is attributed
 *     to it, leaving the parent thread yielding nothing. Every event is still counted exactly once,
 *     which is the property every number depends on; which of two linked threads owns the shared
 *     turns is arbitrary, and giving them to the one the person actually continued in is the more
 *     useful of the two arbitrary answers.
 *
 * AND ONE THING THIS FORMAT ONLY HALF TELLS US, which constrains what may be claimed from it.
 * "aborted by user" is written BOTH when the person rejects an approval prompt and when they stop a
 * command that was already running. Claude records those as different events; Codex does not, and
 * duration cannot separate them (the reference corpus spans 1.9s–14.0s, and a rejection's elapsed
 * time is only how long the person took to answer). But the tool DOES record the approval policy in
 * force per turn, and that decides the question in one direction: under `never` nothing can prompt,
 * so the abort can only have been a stop mid-flight — a course correction, not a refusal. Under any
 * prompting policy it stays ambiguous and keeps `user-rejected`, the broader reading. So a Codex
 * decline means "the person stopped this tool call when they could have been asked", which is still
 * slightly broader than the same word for Claude Code: comparable WITHIN a tool, and anything that
 * would compare declines ACROSS Records needs to know that first.
 *
 * WHY IT STREAMS. Rollouts in the wild reach gigabytes (reported: one 6.9GiB file, one 755GiB
 * sessions directory) because every command's full output is recorded. The Claude reader slurps
 * whole files, which is safe for its format and would be fatal for this one. Lines are read in
 * bounded chunks and discarded as they go, so a single transcript can never blow the heap — and
 * because the contract hands the engine a synchronous generator, the streaming is synchronous too
 * rather than making every consumer async for one Record's benefit.
 *
 * NO ARCHIVE SLICE, deliberately: Codex has no reaper, so its history does not expire and there is
 * nothing to rescue. `protect()` is honestly absent rather than a no-op that implies otherwise.
 */
import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import { PASTE_BOUND, isTypedMessage, type DriftReport, type Session, type Turn } from './seam.js';

/** Where Codex keeps its rollouts. `CODEX_HOME` moves the whole directory, and honouring it is what
 *  lets a test drive a fixture without touching a real one. */
export function roots(): string[] {
  return [codexSessions(), archiveSlice()];
}

/** Where Codex itself keeps rollouts. */
/** Codex's own directory. `CODEX_HOME` moves all of it — every Codex-facing module resolves through
 *  here so the three legs can never disagree about where the tool lives. */
export const codexHome = (): string => process.env.CODEX_HOME || join(homedir(), '.codex');

const codexSessions = (): string => join(codexHome(), 'sessions');

/**
 * THIS RECORD'S SLICE OF OUR VAULT — a named subdirectory, never the root.
 *
 * The root belongs to Claude Code for historical reasons (it was the only Record when the vault was
 * made, and its copies are flat filenames there). A second Record archiving into that root would be
 * read back as Claude Code JSONL, so slices are directories and each Record reads only its own —
 * the Claude reader refuses to descend into one for exactly this reason.
 */
export const archiveSlice = (): string => join(homedir(), '.stratless', 'archive', 'codex');

/** Read in bounded chunks. Big enough that a normal rollout is a couple of reads, small enough that
 *  a 7GB one is still flat. */
const CHUNK = 1 << 18;
/** A single line past this is not a conversation, it is a command that printed a binary. Skipped
 *  whole rather than buffered — one such line has crashed other tools reading this format. */
const MAX_LINE = 4 * 1024 * 1024;

/** Every rollout under these roots, NEWEST-MODIFIED FIRST — same ordering contract as any Record,
 *  so a caller wanting the recent window can stop early. */
export function transcriptFiles(rs: string[]): string[] {
  const found: { path: string; mtime: number }[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // a root that does not exist is simply empty
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) {
        try {
          found.push({ path: p, mtime: statSync(p).mtimeMs });
        } catch {
          /* vanished mid-walk */
        }
      }
    }
  };
  for (const r of rs) walk(r);
  return found.sort((a, b) => b.mtime - a.mtime).map((f) => f.path);
}

/** Compressed rollouts, which we can see but cannot read. Counted so the canary can say "your
 *  history is there and I cannot open it" instead of "you have no history". */
export function compressedFiles(rs: string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl.zst')) found.push(p);
    }
  };
  for (const r of rs) walk(r);
  return found;
}

/** One file's lines, streamed. Never holds more than a chunk plus the current line. */
function* linesOf(path: string): Generator<string> {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return;
  }
  const decoder = new StringDecoder('utf8'); // a chunk boundary can split a multi-byte character
  const buf = Buffer.allocUnsafe(CHUNK);
  let carry = '';
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, CHUNK, null);
      if (n <= 0) break;
      const parts = (carry + decoder.write(buf.subarray(0, n))).split('\n');
      carry = parts.pop() ?? '';
      for (const p of parts) yield p;
      if (carry.length > MAX_LINE) carry = ''; // drop the monster line, keep reading the file
    }
    const tail = carry + decoder.end();
    if (tail) yield tail;
  } finally {
    closeSync(fd);
  }
}

/** The envelope every line carries: `{timestamp, type, payload}`. */
interface Line {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

/** The first line of a rollout describes the whole thread. */
interface Meta {
  id?: string;
  session_id?: string;
  cwd?: string;
  originator?: string;
  cli_version?: string;
  source?: string;
  thread_source?: string;
  history_mode?: string;
  forked_from_id?: string;
  git?: { branch?: string };
}

/** Which threads are the PERSON working, rather than machinery. `exec` is how a borrowed one-shot
 *  runs (our own naming call would land here), `mcp` is a program driving Codex, and a
 *  `thread_source` other than `user` is a subagent or an internal consolidation pass. */
const HUMAN_SOURCES = new Set(['cli', 'vscode']);
const isHumanThread = (m: Meta): boolean =>
  HUMAN_SOURCES.has(String(m.source ?? '')) && String(m.thread_source ?? 'user') === 'user';

/** The history layouts this reader has been verified against. An unknown one is refused rather than
 *  guessed at — Codex takes exactly this posture toward its own older files, and a layout we do not
 *  understand yields silence, which is the failure the canary exists to prevent. */
const KNOWN_HISTORY_MODES = new Set(['legacy', 'paginated']);

/**
 * A refusal, in every dialect this reader knows.
 *
 * The shipped 0.146.0 says "aborted by user"; the upstream source says "rejected by user". Both are
 * whole-body matches, never substrings: the word "rejected" appeared seven times inside innocent
 * documentation echoed through tool output in a ten-minute corpus, and a substring match would have
 * manufactured seven refusals the person never made.
 */
const REFUSAL_PREFIXES = ['aborted by user', 'rejected by user'];
/** Refusals that are NOT the person: a hook or a policy said no, and counting it as their friction
 *  would put a decision they never made into their own profile. */
const NOT_THE_PERSON = ['rejected by configuration', 'automatic approval review denied'];

const refusalKind = (output: string): 'user-rejected' | 'automode-blocked' | undefined => {
  const body = output.trim();
  if (NOT_THE_PERSON.some((p) => body.startsWith(p))) return 'automode-blocked';
  if (REFUSAL_PREFIXES.some((p) => body.startsWith(p))) return 'user-rejected';
  return undefined;
};

/**
 * A STABLE IDENTITY for a line — the hard part of this format, and it took real files to get right.
 *
 * `codex fork` copies its parent's whole history into the new file, so the same event exists twice
 * on disk and a naive read counts the person's work twice. But the copy is not byte-identical: the
 * envelope's `timestamp` is REWRITTEN to the fork's creation time, so hashing the line fails.
 *
 * Two kinds of record, two identities:
 *  · `response_item`s carry their own `id` (`ctc_…`, `ctco_…`) which the copy preserves — use it.
 *  · `event_msg`s carry none, so identity is (lineage, position, content). Position matters: the
 *    reference corpus holds a person asking the SAME thing twice in one thread, and keying on
 *    content alone would delete a message they really sent. Lineage scoping matters too, or two
 *    unrelated threads whose third message is both "continue" would collapse into one.
 *
 * A fork's copied prefix sits at the same positions as in its parent, so the keys line up and the
 * second read of an event is dropped. (A fork OF a fork scopes to its immediate parent rather than
 * the original root; chained forks would under-dedup, which errs toward keeping evidence.)
 */
const eventKey = (lineage: string, index: number, payload: unknown): string =>
  `${lineage}#${index}:${createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 12)}`;

const textOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * WHAT A CALL ACTUALLY INVOKED.
 *
 * Codex names every call `exec`, so a tool mix read from the name alone is one bucket at 100% — a
 * row that takes up space and says nothing, where the same row for Claude Code reads
 * "Bash · Edit · Read". The detail is not missing, only written one level down: the call's own input
 * declares `tools.exec_command`, or opens with the `*** Begin Patch` envelope, or calls
 * `tools.web__run`. Those are Codex's own API names, so reading them out reports a fact the tool
 * recorded rather than guessing at one it did not.
 *
 * An input this does not recognise KEEPS THE TOOL'S OWN NAME. A new kind of call must show up as
 * itself and be visibly uncounted, never be filed under a label we made up for it.
 */
export function toolName(payload: Record<string, unknown>): string {
  const declared = textOf(payload.name) || 'exec';
  const input = typeof payload.input === 'string' ? payload.input : '';
  if (!input || declared !== 'exec') return declared;
  if (input.includes('*** Begin Patch')) return 'apply_patch';
  return /\btools\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(input)?.[1] ?? declared;
}

/**
 * WHICH SKILL A CALL LOADED, if it loaded one.
 *
 * Codex has skills but no `Skill` tool: the assistant loads one by READING
 * `skills/<name>/SKILL.md` through an ordinary shell command, so the fact is recorded and the name
 * is in the path. `.system/` marks Codex's own built-ins and stays part of the name, because where
 * a skill came from is information rather than noise.
 *
 * Reading the file is the load. A command that merely mentions the directory — listing it, grepping
 * it — is not, which is why this matches the SKILL.md itself and nothing looser.
 */
export function skillsOf(payload: Record<string, unknown>): string[] | undefined {
  const input = typeof payload.input === 'string' ? payload.input : '';
  if (!input) return undefined;
  const names = new Set<string>();
  for (const m of input.matchAll(/skills\/((?:\.system\/)?[A-Za-z0-9._-]+)\/SKILL\.md/g)) names.add(m[1]);
  return names.size ? [...names] : undefined;
}

/**
 * ONE ROLLOUT'S clean turns. `seen` is the caller's cross-file id set — pass the same one across a
 * walk so a forked thread's copied history is read once, ever.
 *
 * Returns [] for a thread that is not the person's, without reading past its first line.
 */
export function turnsOfFile(path: string, seen: Set<string> = new Set()): Turn[] {
  const turns: Turn[] = [];
  let meta: Meta | undefined;
  let session = '';
  let lineage = '';
  let cwd: string | undefined;
  let branch: string | undefined;
  let index = 0; // position among non-header records — half of an event's identity

  /** call_id → tool name, so a refusal can name what it refused. */
  const toolNames = new Map<string, string>();
  /** The approval policy in force, which the tool records per turn and which is the only evidence
   *  that separates rejecting a prompt from stopping a command already running. */
  let policy = '';
  /** call_id → the policy at the moment that call was made, since a thread can change it mid-way. */
  const policyAt = new Map<string, string>();
  /** turn_id → the tools refused in it, so an abort can be told from a course correction. */
  const refusedIn = new Map<string, string[]>();
  /** aborts wait for the whole file: their kind depends on refusals that may not have been read yet. */
  const aborts: { index: number; turnId: string }[] = [];

  for (const raw of linesOf(path)) {
    if (!raw.trim()) continue;
    let line: Line;
    try {
      line = JSON.parse(raw) as Line;
    } catch {
      continue; // a torn or oversized line is not evidence
    }
    const payload = line.payload ?? {};
    const kind = String(payload.type ?? '');

    if (line.type === 'session_meta') {
      // The FIRST one describes this thread; a later one is the parent's, copied in by a fork.
      if (meta) continue;
      meta = payload as Meta;
      if (!isHumanThread(meta)) return [];
      if (!KNOWN_HISTORY_MODES.has(String(meta.history_mode ?? 'legacy'))) return [];
      session = `codex:${meta.id ?? meta.session_id ?? ''}`;
      // A fork's records belong to the thread they were copied FROM, which is what makes its
      // duplicate of the parent's history recognisable as the same events.
      lineage = String(meta.forked_from_id ?? meta.id ?? '');
      cwd = meta.cwd;
      branch = meta.git?.branch;
      continue;
    }
    if (line.type === 'turn_context') {
      policy = textOf(payload.approval_policy) || policy;
      continue;
    }
    if (!meta) continue; // nothing before the header is interpretable

    const own = typeof payload.id === 'string' ? payload.id : '';
    const id = own ? `p:${own}` : eventKey(lineage, index, payload);
    index++;
    if (seen.has(id)) continue; // a fork's copied history is one event, not two
    seen.add(id);

    const ts = line.timestamp ?? '';
    const base = { uuid: id, session, ts, interrupted: false, pasted: false, images: 0, cwd, gitBranch: branch };

    // ── what the person typed. The EVENT, never the model-facing copy (see the header) ──────────
    if (line.type === 'event_msg' && kind === 'user_message') {
      const text = textOf(payload.message);
      const images = Array.isArray(payload.images) ? payload.images.length : 0;
      if (!text && !images) continue;
      // THIRD LAYER against eating our own exhaust, mirroring the Claude reader's. The instructions
      // file we write the profile into is echoed into this rollout on the model-facing channel,
      // which we already ignore — this catches it if a future change ever starts reading that
      // channel, because our own words arriving as the person's is the one input that would make
      // the profile confirm itself.
      if (looksLikeOurs(text)) continue;
      turns.push({ ...base, role: 'user', text, pasted: text.length > PASTE_BOUND, images });
      continue;
    }

    // ── what the assistant said ─────────────────────────────────────────────────────────────────
    if (line.type === 'event_msg' && kind === 'agent_message') {
      const text = textOf(payload.message);
      if (!text) continue;
      turns.push({ ...base, role: 'assistant', text });
      continue;
    }

    // ── what it did. The call names the tool; its output may carry a refusal ────────────────────
    if (line.type === 'response_item' && (kind === 'custom_tool_call' || kind === 'function_call')) {
      const name = toolName(payload);
      const callId = textOf(payload.call_id);
      if (callId) {
        toolNames.set(callId, name);
        policyAt.set(callId, policy);
      }
      const skills = skillsOf(payload);
      // `skillCount` is the NAMED count here and not a tally, because Codex loads a skill by
      // reading its file rather than by calling a tool of its own — so an unnamed load is not a
      // thing this format can produce, and the count and the names agree by construction.
      // `delegationCount` is deliberately ABSENT rather than 0: Codex spawns subagents as separate
      // THREADS, so a handoff is real but recorded nowhere in the parent's rollout. Reporting zero
      // would claim this person never delegates, which the record cannot support.
      turns.push({
        ...base,
        role: 'assistant',
        text: '',
        tools: [name],
        ...(skills ? { skills, skillCount: skills.length } : {}),
      });
      continue;
    }

    if (line.type === 'response_item' && (kind === 'custom_tool_call_output' || kind === 'function_call_output')) {
      const denial = refusalKind(typeof payload.output === 'string' ? payload.output : '');
      if (!denial) continue; // an ordinary result is work already recorded by its call
      const callId = textOf(payload.call_id);
      const refused = toolNames.get(callId);
      const turnId = textOf((payload.internal_chat_message_metadata_passthrough as { turn_id?: unknown } | undefined)?.turn_id);

      // THE POLICY LEVER. Codex writes this same record whether the person rejected an approval
      // prompt or stopped a command already running — but when the policy in force was `never`,
      // NOTHING could have prompted them, so it can only have been the second. That is a stop
      // mid-flight, which is a course correction and not a refusal, and calling it a decline would
      // put a permission event into the profile of someone who was never asked for permission.
      // Duration cannot make this call (the corpus spans 1.9s–14.0s and a rejection's elapsed time
      // is just how long the person took to answer), so this is the only evidence there is — and it
      // decides in one direction only: under any prompting policy the record stays ambiguous and
      // keeps the broader reading.
      if (denial === 'user-rejected' && (policyAt.get(callId) ?? policy) === 'never') {
        turns.push({ ...base, role: 'user', text: '', interrupted: true, interruptKind: 'plain' });
        continue;
      }

      if (denial === 'user-rejected' && turnId && refused) refusedIn.set(turnId, [...(refusedIn.get(turnId) ?? []), refused]);
      turns.push({ ...base, role: 'user', text: '', denial, ...(refused ? { deniedTools: [refused] } : {}) });
      continue;
    }

    // ── the person stopped it. Which KIND is decided once the whole file has been read ──────────
    if (line.type === 'event_msg' && kind === 'turn_aborted') {
      if (String(payload.reason ?? '') !== 'interrupted') continue; // replaced/budget aborts are not the person
      aborts.push({ index: turns.length, turnId: textOf(payload.turn_id) });
      turns.push({ ...base, role: 'user', text: '', interrupted: true, interruptKind: 'plain' });
    }
  }

  // An abort in a turn that also holds a refusal is the tail of the permission flow, not a
  // spontaneous course correction. Same distinction Claude draws with two message strings.
  for (const a of aborts) {
    if (a.turnId && refusedIn.has(a.turnId)) turns[a.index].interruptKind = 'tool-use';
  }
  return turns;
}

/** Yield one rollout's clean turns at a time, newest file first. */
export function* readSessions(rs: string[] = roots()): Generator<Session> {
  const seen = new Set<string>();
  for (const path of transcriptFiles(rs)) {
    const turns = turnsOfFile(path, seen);
    if (turns.length) yield { path, session: turns[0].session, turns };
  }
}

/** Every clean turn under these roots, as one flat stream. */
export function* readTurns(rs: string[] = roots()): Generator<Turn> {
  for (const s of readSessions(rs)) for (const t of s.turns) yield t;
}

/** Below this, a person's own rollouts are too slight to tell drift from a fresh start. */
export const DRIFT_MIN_BYTES = 500_000;

/**
 * THE CANARY — refuse rather than report an empty person.
 *
 * Two ways this Record can go blind, and they need different words. The format can MOVE, which
 * looks like substantial rollouts yielding not one typed turn. Or the history can be COMPRESSED,
 * which we can see and cannot open — Codex zstd-compresses rollouts older than a week when that
 * feature is on, and Node ships no zstd. Saying "no conversations" over either would be a lie about
 * a person who has been working all month.
 */
export function driftCheck(rs: string[] = roots(), opts: { minBytes?: number } = {}): DriftReport {
  const minBytes = opts.minBytes ?? DRIFT_MIN_BYTES;
  const compressed = compressedFiles(rs);

  let files = 0;
  let bytes = 0;
  for (const path of transcriptFiles(rs)) {
    try {
      const size = statSync(path).size;
      if (!size) continue;
      files++;
      bytes += size;
    } catch {
      /* vanished — not evidence either way */
    }
  }

  if (compressed.length && !files) {
    return {
      ok: false,
      files: compressed.length,
      bytes: 0,
      typed: 0,
      reason:
        `Found ${compressed.length} compressed Codex rollout${compressed.length === 1 ? '' : 's'} (.jsonl.zst) and nothing stratless can read.\n` +
        `Your history is there; this version cannot open the compressed form.\n` +
        `\n` +
        `stratless will NOT guess — a profile built from an empty read would describe a person it never saw.\n` +
        `\n` +
        `Please open an issue (no code needed): https://github.com/stratless-ai/stratless/issues/new?title=codex+compressed+rollouts`,
    };
  }

  if (bytes < minBytes) return { ok: true, files, bytes, typed: 0 };

  for (const t of readTurns(rs)) {
    if (isTypedMessage(t)) return { ok: true, files, bytes, typed: 1 };
  }

  return {
    ok: false,
    files,
    bytes,
    typed: 0,
    reason:
      `Found ${(bytes / 1e6).toFixed(1)}MB of your own Codex conversations across ${files} rollout${files === 1 ? '' : 's'}, but read NONE of them.\n` +
      `Codex's log format has almost certainly changed under stratless.\n` +
      `\n` +
      `stratless will NOT guess — a profile built from an empty read would describe a person it never saw.\n` +
      `\n` +
      `Please open an issue (no code needed): https://github.com/stratless-ai/stratless/issues/new?title=codex+format+drift`,
  };
}

/** Our managed block, arriving as if it were something the person said. Never counted. */
function looksLikeOurs(text: string): boolean {
  return text.includes('<!-- stratless:start -->');
}
