/**
 * THE CLAUDE CODE RECORD — its transcripts, and the one place that decides what counts as the
 * person talking in them.
 *
 * The first of stratless's Records (see `seam.ts` for the contract, `adapters.ts` for the registry
 * that wraps these functions into it). Everything below is knowledge about how ONE tool writes its
 * history down; nothing here may leak upward, and the engine never imports this file.
 *
 * Seven independent attempts to count one person's messages produced 4,437 / 4,773 / 5,502 /
 * 5,517 / 5,702 / 6,156 / 6,387 — same archive, same question, a 44% spread. Every one of them
 * drew the line somewhere different, and each was wrong in its own way. That is the whole reason
 * this module exists: the decisions below are made ONCE, and everything downstream reads what
 * comes out of here rather than re-deriving it. A second Record inherits the LESSON, never the
 * answers — each tool has its own ways of writing down things the person never typed.
 *
 * Five things are removed, and each one was found by getting it wrong first:
 *
 *  1. OUR OWN FOOTPRINTS. Every borrowed `claude -p` call spawns a session Claude Code writes to
 *     ~/.claude/projects — the same folder we read. 748 of 869 archived files are stratless
 *     talking to itself. Its prompts quote the person verbatim, so counting them both invents
 *     vocabulary ("PERSON ASKED", "You are building a PROFILE OF A HUMAN") and double-counts the
 *     person's real words. `entrypoint` names the culprit and never mixes within a file.
 *  2. SUBAGENTS AND BOOKKEEPING. Not the person (isSidechain / isMeta).
 *  3. HARNESS WRAPPERS. Injected blocks that arrive inside a user record but were never typed.
 *  4. REPLAYS. Resuming a session re-writes its history to disk under fresh records; 1,494
 *     duplicate user uuids exist archive-wide. Counting a replay is counting an event twice.
 *  5. DRAFTS. Editing before sending archives every superseded version under its OWN uuid, so
 *     uuid dedup cannot see them — 19.6% of messages carry at least one ghost. Measured rule:
 *     user records sharing (session, parentUuid) are ALTERNATIVES, keep the last. Verified safe —
 *     genuine multi-part requests chain instead (365 of them: parent is the prior user message),
 *     so they never collide with a draft group.
 *
 * Memory stays flat (criterion C1): files are parsed one at a time and turns are yielded, never
 * accumulated. The only cross-file state is the seen-uuid set, which is bounded by archive size.
 */
import { readFileSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { PASTE_BOUND, isTypedMessage, type Turn, type DriftReport } from './seam.js';

/** Per-file size ceiling — one pathological transcript cannot blow the heap. */
const FILE_CAP_BYTES = 96 * 1024 * 1024;

/**
 * Both places a Claude Code transcript lives: where the tool writes them, and our own copy that
 * outlives its 30-day reaper. Read as a union — a record present in both is deduped by uuid like
 * any replay.
 *
 * A FUNCTION, because the constant froze at import: a test wanting to read a fixture archive had to
 * fork a subprocess to get a different HOME. The registry asks at call time. `DEFAULT_ROOTS` stays
 * as the snapshot the existing default parameters use, derived from here so exactly one place knows
 * where a transcript lives.
 */
export function roots(): string[] {
  return [join(homedir(), '.claude', 'projects'), archiveRoot()];
}

/**
 * OUR OWN VAULT, and this Record's slice of it is the ROOT of it — flat, by history: Claude Code was
 * the only Record when the vault was made, and its copies are flattened filenames
 * (`project__session.jsonl`), never nested. Which is exactly what makes the next line safe.
 */
export const archiveRoot = (): string => join(homedir(), '.stratless', 'archive');

export const DEFAULT_ROOTS = roots();

/**
 * Every transcript under these roots, NEWEST-MODIFIED FIRST.
 *
 * Recursive, because `~/.claude/projects` nests one directory per project — a flat readdir sees
 * nothing there at all. mtime only approximates a file's newest exchange, but it is the cheap
 * ordering that lets a caller wanting the recent window stop early instead of walking gigabytes.
 */
export function transcriptFiles(roots: string[]): string[] {
  const found: { path: string; mtime: number; root: string }[] = [];
  let root = '';
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // a root that does not exist is simply empty
    }
    const vault = archiveRoot();
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        // A DIRECTORY DIRECTLY INSIDE THE VAULT IS ANOTHER RECORD'S SLICE, and parsing it here would
        // read a different tool's transcripts as Claude Code JSONL. Ours are flat filenames at the
        // vault root, so descending is never right — and this is the whole reason a second Record
        // can archive anything at all without corrupting this one's read.
        if (dir === vault) continue;
        walk(p);
      } else if (e.name.endsWith('.jsonl')) {
        try {
          found.push({ path: p, mtime: statSync(p).mtimeMs, root });
        } catch {
          /* vanished mid-walk */
        }
      }
    }
  };
  for (const r of roots) {
    root = r;
    walk(r);
  }
  // A TOTAL ORDER, not just newest-first. Sorting on mtime alone leaves ties — and ties are common,
  // since sessions written in the same millisecond share one stamp. A tied comparator falls back to
  // whatever `readdirSync` happened to return, which differs by filesystem (APFS vs ext4). That
  // silently reorders the moment list, and k-means++ picks its seeds BY INDEX, so the same archive
  // clustered into 32/128 on one machine and 80/80 on another. Caught 2026-07-31 by the profile
  // golden failing on CI while passing locally — exactly the reproducibility break it exists to
  // find. The path tiebreak makes the read deterministic on any filesystem.
  return dropArchivedTwins(found)
    .sort((a, b) => b.mtime - a.mtime || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => f.path);
}

/**
 * DROP THE VAULT COPY OF A FILE WE CAN STILL READ LIVE.
 *
 * `protect()` copies each live transcript into the vault under a FLATTENED name
 * (`projects/a/b/s1.jsonl` → `a__b__s1.jsonl`), so once someone has run `init` the same conversation
 * exists twice under two different roots. Records carrying a uuid are deduped downstream; older ones
 * do not carry one, and those were counted TWICE — measured as 2 live records plus their 2 archived
 * copies reading as 3 messages.
 *
 * It is fixed here rather than per record because the duplicate IS a whole file, and the per-record
 * alternative needs a content key this data cannot supply. The live original wins; a vault copy is
 * kept only when its original is gone, which is exactly the case the vault exists for — a transcript
 * the tool's own reaper has already deleted.
 */
function dropArchivedTwins<T extends { path: string; root: string }>(files: T[]): T[] {
  const vault = archiveRoot();
  const liveFlat = new Set<string>();
  for (const f of files) {
    if (f.root === vault) continue;
    liveFlat.add(f.path.slice(f.root.length + 1).split(sep).join('__'));
  }
  return files.filter((f) => !(f.root === vault && liveFlat.has(f.path.slice(vault.length + 1))));
}

/** Blocks that arrive inside a user record but were never typed by anyone. Each entry here was
 *  found leaking into a "person" corpus: task-notification 617, command-name 118,
 *  local-command-stdout 79, bash-input 35, bash-stdout 33. */
const WRAPPERS =
  /<(task-notification|command-name|command-message|command-args|command-contents|system-reminder|local-command-stdout|local-command-stderr|bash-input|bash-stdout|bash-stderr)>[\s\S]*?<\/\1>/g;

const INTERRUPT = /\[Request interrupted by user/i;
/** The permission-flow variant — a consequence of declining a tool, not a spontaneous stop. */
const INTERRUPT_TOOL_USE = /\[Request interrupted by user for tool use\]/i;
/** Compaction summaries are the harness narrating itself back into the transcript. */
const CONTINUATION = /^This session is being continued/;

/** Text of a message's content, text blocks only. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b): b is { type: string; text?: string } => typeof b === 'object' && b !== null)
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n');
}

/** Strip everything the person did not type. Returns '' when nothing typed survives. */
export function stripWrappers(raw: string): string {
  const out = raw.replace(WRAPPERS, ' ').replace(/<\/?[a-z-]+>/g, ' ').trim();
  return CONTINUATION.test(out) ? '' : out;
}

interface RawRecord {
  type?: string;
  uuid?: string;
  parentUuid?: string;
  sessionId?: string;
  timestamp?: string;
  entrypoint?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  cwd?: string;
  gitBranch?: string;
  toolDenialKind?: string;
  interruptedMessageId?: string;
  imagePasteIds?: unknown[];
  message?: { content?: unknown };
}

/** Is this whole file machine traffic? `entrypoint` never mixes within a file, so one hit decides
 *  it — and deciding at the file level skips 748 files of our own footprints without parsing them. */
export function isMachineFile(lines: string[]): boolean {
  for (const line of lines) {
    if (!line) continue;
    let d: RawRecord;
    try {
      d = JSON.parse(line) as RawRecord;
    } catch {
      continue;
    }
    if (d.entrypoint) return d.entrypoint === 'sdk-cli';
  }
  return false; // no entrypoint anywhere: assume the person, and let record-level filters decide
}

/** Count distinct images on a record — by content hash where blocks exist, since imagePasteIds
 *  double-counts across replays and drafts. */
function imagesOf(d: RawRecord): number {
  const c = d.message?.content;
  if (Array.isArray(c)) {
    const n = c.filter((b) => typeof b === 'object' && b !== null && (b as { type?: string }).type === 'image').length;
    if (n) return n;
  }
  return Array.isArray(d.imagePasteIds) ? d.imagePasteIds.length : 0;
}

function toolUsesOf(content: unknown): { name: string; id?: string; input?: unknown }[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((b): b is { type: string; name?: string; id?: string; input?: unknown } => typeof b === 'object' && b !== null)
    .filter((b) => b.type === 'tool_use' && typeof b.name === 'string')
    .map((b) => ({ name: b.name as string, ...(typeof b.id === 'string' ? { id: b.id } : {}), ...(b.input !== undefined ? { input: b.input } : {}) }));
}

function toolsOf(content: unknown): string[] | undefined {
  const names = toolUsesOf(content).map((u) => u.name);
  return names.length ? names : undefined;
}

/** The tools that hand work to another agent. Both names ship in the harness; a transcript may
 *  carry either, so the reader knows both rather than guessing from one. */
const AGENT_TOOLS = new Set(['Task', 'Agent']);

/** The tool that loads a packaged procedure. */
const SKILL_TOOLS = new Set(['Skill']);

/** How many of a turn's calls were of a given kind. THIS FILE is the only place allowed to know
 *  which of Claude Code's tool names mean what; the count travels upward, the names do not. */
const countOf = (tools: string[] | undefined, kinds: Set<string>): number | undefined =>
  tools ? tools.filter((t) => kinds.has(t)).length : undefined;

/** Which agent types a turn handed work to — read from the spawn's own `subagent_type`, never
 *  inferred. An unnamed spawn contributes nothing here (it is still counted as a run via `tools`),
 *  because a delegation we cannot name is a delegation we must not label. */
function delegationsOf(content: unknown): string[] | undefined {
  const types = toolUsesOf(content)
    .filter((u) => AGENT_TOOLS.has(u.name))
    .map((u) => (u.input as { subagent_type?: unknown } | undefined)?.subagent_type)
    .filter((t): t is string => typeof t === 'string' && t.trim() !== '');
  return types.length ? types : undefined;
}

/** Which skills a turn loaded — read from the load's own `skill` argument. Same rule as
 *  delegations: a load that names nothing is counted (via the `Skill` tally) but never labelled. */
function skillsOf(content: unknown): string[] | undefined {
  const names = toolUsesOf(content)
    .filter((u) => u.name === 'Skill')
    .map((u) => (u.input as { skill?: unknown } | undefined)?.skill)
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '');
  return names.length ? names : undefined;
}

/** Which tools a denial record refuses: its tool_result blocks name the declined call by
 *  tool_use_id; the ledger turns the id back into the tool's name. */
function deniedOf(content: unknown, ids: Map<string, string>): string[] | undefined {
  if (!Array.isArray(content)) return undefined;
  const names = content
    .filter((b): b is { type: string; tool_use_id?: string } => typeof b === 'object' && b !== null)
    .filter((b) => b.type === 'tool_result' && typeof b.tool_use_id === 'string')
    .map((b) => ids.get(b.tool_use_id as string))
    .filter((n): n is string => typeof n === 'string');
  return names.length ? names : undefined;
}

/**
 * Yield ONE FILE'S clean turns at a time, newest-modified file first.
 *
 * Per-file rather than a flat stream because pairing must never cross a session: a transcript is one
 * session, and a prompt in one may not answer a reply in another. Newest-first so a caller wanting
 * only the recent window can stop iterating — this generator is the early stop, no `want` needed.
 *
 * `seen` carries uuid state across files, so a record replayed by a session resume — or present in
 * both roots — is emitted once, ever.
 */
export function* readSessions(roots: string[] = DEFAULT_ROOTS): Generator<{ path: string; session: string; turns: Turn[] }> {
  const seen = new Set<string>();
  for (const path of transcriptFiles(roots)) {
    const turns = turnsOfFile(path, seen);
    if (turns.length) yield { path, session: turns[0].session, turns };
  }
}

/**
 * One transcript's clean turns. `seen` is the caller's cross-file uuid set — pass the same one
 * across a walk so a replayed record is emitted once, ever.
 */
export function turnsOfFile(path: string, seen: Set<string> = new Set()): Turn[] {
  {
    let lines: string[];
    try {
      if (statSync(path).size > FILE_CAP_BYTES) return [];
      lines = readFileSync(path, 'utf8').split('\n');
    } catch {
      return [];
    }
    if (isMachineFile(lines)) return [];

    // Parse the file's turns first: draft collapse needs to see a whole group before it can know
    // which member survived. Bounded by one file, so memory stays flat across the archive.
    const turns: Turn[] = [];
    // The id→name ledger for denial attribution — one file is one session, and a denial always
    // follows the tool_use it refuses within it.
    const toolIds = new Map<string, string>();
    const drafts = new Map<string, number>(); // (session|parentUuid) -> index of the latest so far

    for (const line of lines) {
      if (!line) continue;
      let d: RawRecord;
      try {
        d = JSON.parse(line) as RawRecord;
      } catch {
        continue;
      }
      if (d.type !== 'user' && d.type !== 'assistant') continue;
      if (d.isSidechain || d.isMeta || d.isCompactSummary) continue;
      if (d.entrypoint === 'sdk-cli') continue; // belt and braces: a mixed file cannot slip through
      // Feed the ledger before dedup on purpose: a replayed assistant record still names the tool
      // a later denial refers to.
      if (d.type === 'assistant') for (const u of toolUsesOf(d.message?.content)) if (u.id) toolIds.set(u.id, u.name);
      // Dedup only when there IS a uuid. A record without one cannot be a known replay, and
      // dropping it would silently lose evidence — older transcripts do not always carry it.
      // (The archived COPY of a live file is excluded a level up, in `transcriptFiles` — that
      // duplicate is a whole file, and solving it per record needs a content key this data cannot
      // supply: a fixture without timestamps makes two distinct messages look identical.)
      if (d.uuid) {
        if (seen.has(d.uuid)) continue; // a replay is not a second event
        seen.add(d.uuid);
      }

      const raw = textOf(d.message?.content);
      // THIRD LAYER against eating our own exhaust. entrypoint and the file-level check already
      // exclude borrowed calls; this catches a streamed turn if either ever misses, because
      // stripWrappers would otherwise remove the `<stratless-judge>` tag and leave OUR prompt
      // looking like the person's words.
      if (raw.startsWith('<stratless-')) continue;
      const interrupted = d.type === 'user' && INTERRUPT.test(raw);
      const text = interrupted ? '' : stripWrappers(raw);
      const tools = d.type === 'assistant' ? toolsOf(d.message?.content) : undefined;

      // Keep a record only if it carries something real: typed text, an interrupt, a denial,
      // an image, or (assistant-side) work performed.
      if (!text && !interrupted && !d.toolDenialKind && !tools && !imagesOf(d)) continue;

      const turn: Turn = {
        uuid: d.uuid ?? '',
        session: d.sessionId ?? '',
        ts: d.timestamp ?? '',
        role: d.type,
        text,
        interrupted,
        interruptKind: interrupted ? (INTERRUPT_TOOL_USE.test(raw) ? 'tool-use' : 'plain') : undefined,
        pasted: text.length > PASTE_BOUND,
        cwd: d.cwd,
        gitBranch: d.gitBranch,
        tools,
        delegations: d.type === 'assistant' ? delegationsOf(d.message?.content) : undefined,
        skills: d.type === 'assistant' ? skillsOf(d.message?.content) : undefined,
        // THE COUNTS, which are not the same question as the names. Claude Code's handoff and
        // skill tools are `Task`/`Agent` and `Skill`, and knowing that is THIS file's job — the
        // engine used to look those names up itself, and threw away every load an assistant using
        // other words had recorded. Counted from the tally so an unnamed spawn is still work
        // handed off; absent on a turn that ran no tools at all, never a zero.
        delegationCount: d.type === 'assistant' ? countOf(tools, AGENT_TOOLS) : undefined,
        skillCount: d.type === 'assistant' ? countOf(tools, SKILL_TOOLS) : undefined,
        denial: d.toolDenialKind,
        deniedTools: d.toolDenialKind ? deniedOf(d.message?.content, toolIds) : undefined,
        images: imagesOf(d),
      };

      // DRAFT COLLAPSE: user records sharing a parent are alternatives, not a sequence. Genuine
      // multi-part requests chain (parent = the prior user record), so they never land here.
      if (d.type === 'user' && text && d.parentUuid) {
        const key = `${turn.session}|${d.parentUuid}`;
        const prior = drafts.get(key);
        if (prior !== undefined) {
          turns[prior] = turn; // the later record supersedes the draft in place
          continue;
        }
        drafts.set(key, turns.length);
      }
      turns.push(turn);
    }

    return turns;
  }
}

/** Every clean turn under these roots, as one flat stream. */
export function* readTurns(roots: string[] = DEFAULT_ROOTS): Generator<Turn> {
  for (const s of readSessions(roots)) for (const t of s.turns) yield t;
}

/** Below this, the person's OWN transcripts are too slight to tell drift from a fresh start: a
 *  single real session clears it many times over, a new machine never does. */
export const DRIFT_MIN_BYTES = 500_000;

/**
 * THE CANARY (v3) — the alarm for the one failure that would end this product silently.
 *
 * Claude Code owns the transcript format and will change it — not if, when. When it does, the reader
 * can quietly yield nothing, and a profile built from an empty read would describe a person it never
 * saw. The edit-era canary keyed on write tools; this one keys on what the v3 engine actually reads:
 * the person's typed turns.
 *
 * CONSERVATIVE BY DESIGN, like its predecessor — it refuses only on the one unambiguous signal: the
 * person's OWN transcripts hold real content (>= `minBytes`, our borrowed calls excluded) yet the
 * reader extracts NOT ONE typed turn. A fresh machine (too little content) and a talk-only history
 * (content that DOES read) both pass. You cannot accumulate half a megabyte of your own sessions
 * with zero readable messages unless the format moved under us. Meant to run only when a build
 * produced zero moments, so it never costs a healthy run.
 */
export function driftCheck(roots: string[] = DEFAULT_ROOTS, opts: { minBytes?: number } = {}): DriftReport {
  const minBytes = opts.minBytes ?? DRIFT_MIN_BYTES;

  let files = 0;
  let bytes = 0;
  for (const path of transcriptFiles(roots)) {
    let size: number;
    let lines: string[];
    try {
      size = statSync(path).size;
      if (size === 0 || size > FILE_CAP_BYTES) continue;
      lines = readFileSync(path, 'utf8').split('\n');
    } catch {
      continue; // vanished or unreadable — not evidence either way
    }
    if (isMachineFile(lines)) continue; // our own borrowed calls are not the person, and never parse
    files++;
    bytes += size;
  }

  // Too little of the person's own history to tell "the format moved" from "nothing here yet".
  if (bytes < minBytes) return { ok: true, files, bytes, typed: 0 };

  // Substantial history exists — did we read ANY of it? One typed turn means the reader still works.
  for (const t of readTurns(roots)) {
    if (isTypedMessage(t)) return { ok: true, files, bytes, typed: 1 };
  }

  // Real transcripts, not one typed turn read: the single signal we refuse on.
  return {
    ok: false,
    files,
    bytes,
    typed: 0,
    reason:
      `Found ${(bytes / 1e6).toFixed(1)}MB of your own conversations across ${files} transcript${files === 1 ? '' : 's'}, but read NONE of them.\n` +
      `Claude Code's log format has almost certainly changed under stratless.\n` +
      `\n` +
      `stratless will NOT guess — a profile built from an empty read would describe a person it never saw.\n` +
      `\n` +
      `Please open an issue (no code needed): https://github.com/stratless-ai/stratless/issues/new?title=format+drift`,
  };
}

/**
 * Session titles the harness already wrote — a topic surface someone else paid the inference for.
 *
 * `ai-title` records carry no `entrypoint` and no timestamp, so they cannot be filtered or ordered
 * on their own: they must be joined on `sessionId` against the sessions readTurns accepted, or the
 * list fills with titles of OUR OWN borrowed calls ("Confirm acknowledgment", "Acknowledge simple
 * response"). Kept as a separate pass because it reads a record type readTurns deliberately drops.
 */
export function readTitles(dir: string): { aiTitle: string; sessionId: string }[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  const out: { aiTitle: string; sessionId: string }[] = [];
  for (const f of files) {
    const path = join(dir, f);
    let lines: string[];
    try {
      if (statSync(path).size > FILE_CAP_BYTES) continue;
      lines = readFileSync(path, 'utf8').split('\n');
    } catch {
      continue;
    }
    for (const line of lines) {
      if (!line || !line.includes('"ai-title"')) continue;
      try {
        const d = JSON.parse(line) as { type?: string; aiTitle?: string; sessionId?: string };
        if (d.type === 'ai-title' && d.aiTitle && d.sessionId) out.push({ aiTitle: d.aiTitle, sessionId: d.sessionId });
      } catch {
        /* a malformed line is not a title */
      }
    }
  }
  return out;
}
