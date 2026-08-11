/**
 * THE SEAM — what the engine understands, with no idea whose tool produced it.
 *
 * stratless reads one assistant today and is built to read several. The line between "how a
 * particular tool writes its history down" and "what stratless does with a person's behaviour" was
 * always there — every hygiene rule, every format regex, the whole drift canary lived in ONE file —
 * but it was never written down, so nothing enforced it. This module is that line, stated.
 *
 * The shape (the war room calls it the hourglass): many RECORDS at the top, each reading one tool's
 * transcripts into `Turn`s · one WAIST in the middle — the engine, the pile, one HUMAN.md, all of it
 * tool-blind · many ways back down to the person's assistants. A tool's RHYTHM is the third leg: the
 * after-session signal that keeps the loop alive without the person doing anything.
 *
 * THE RULE THAT MAKES IT WORTH HAVING: a Record produces `Turn`s and the waist does everything else.
 * Adding an assistant should cost one new file and no edits to the engine. If it ever forces a change
 * to exchange/moments/shape/embed/cluster/name/count/write/lift, the seam has leaked — stop and fix
 * the boundary rather than the symptom.
 *
 * THE BRAIN IS HERE BUT NOT ON THE ADAPTER, and the difference matters: it is PROVIDER-bound, so
 * one brain can read any assistant's history. It gets its own contract and its own registry
 * (`brains/registry.ts`), never a field on `Adapter` — a machine reading one tool's transcripts with
 * another tool's model is not an edge case, it is the common one.
 *
 * THE RETURN LEG IS HERE NOW (2026-07-31), and it took a second assistant to see its real shape.
 * The question that held it open was whether a local MCP server replaced the context-file write.
 * The load leg survives the profile going internal (2026-08-10) for its OFF half: unload() takes
 * our pointer out of older installs, and the off switch has to stay as complete as the on switch
 * ever was. load() is machinery without a caller now, kept because the interface is per-tool and
 * a future surface may push through it again.
 *
 * The two implementations differ more than "write a file" suggests, which is why this is an
 * interface and not a shared function: Claude Code expands an `@import`, so its file is a POINTER
 * that keeps working as the profile is rebuilt beneath it. Codex has no import syntax at all, so
 * its file is a COPY that goes stale unless every build rewrites it. Same contract, opposite
 * failure modes.
 *
 * Nothing in this file may import anything tool-specific. That is checkable, and it is the test.
 */

/**
 * ONE TURN, after every hygiene decision has already been made — the unit the whole engine reads.
 *
 * Optional fields are OPTIONAL ON PURPOSE: assistants record different amounts of the conversation,
 * and the ones that carry the other side of it (what the assistant did, what the person refused) are
 * exactly the ones that fuel the strongest reads. A Record fills in what its tool actually wrote down
 * and leaves the rest absent — never a zero, never a guess. Absence means "this tool does not record
 * it", which downstream must treat as unknown rather than as "it did not happen" (see `Tier`).
 */
export interface Turn {
  /** the record's own id where the tool has one, '' where it does not. Replay dedup keys on this. */
  uuid: string;
  /** which conversation — the scoreboard's floor and the rules' stumble unit. Namespaced per Record
   *  when a tool's ids could collide with another's. */
  session: string;
  /** ISO timestamp; '' when the record carried none */
  ts: string;
  role: 'user' | 'assistant';
  /** typed prose only — every wrapper the harness injected already stripped. Empty on an
   *  interrupt-only record. */
  text: string;
  /** the person stopped the assistant mid-flight. A control action, NOT a message: never counted
   *  as one. */
  interrupted: boolean;
  /**
   * WHICH interrupt, because they are not the same event: 'plain' is a spontaneous course
   * correction, 'tool-use' is the tail of a permission flow — generation stopped BECAUSE something
   * was declined. Summing the two is exactly how a wrong friction figure once got published.
   */
  interruptKind?: 'plain' | 'tool-use';
  /** over PASTE_BOUND — counts as a message, excluded from length statistics */
  pasted: boolean;
  cwd?: string;
  gitBranch?: string;
  /** assistant turns only: what it invoked here, in order, duplicates kept */
  tools?: string[];
  /** assistant turns only: the agent types it handed work to, one entry per NAMED handoff. A
   *  handoff we cannot name is one we must not label, so an unnamed one appears here not at all —
   *  `delegationCount` is what counts it. */
  delegations?: string[];
  /** assistant turns only: packaged procedures loaded here, by name. The record cannot tell whether
   *  the person or the assistant reached for one, so nothing downstream may claim it was theirs. */
  skills?: string[];
  /**
   * HOW MANY handoffs and skill loads this turn held, named or not.
   *
   * These exist because the two arrays above are NAMED-ONLY, and a spawn whose type we cannot read
   * is still work handed off — dropping it would undercount. Count and names answer different
   * questions and both are needed: `delegationCount >= delegations.length`, always.
   *
   * ABSENT, NEVER ZERO, when the tool does not record the event at all. Zero means "it did not
   * happen"; absent means "this tool cannot tell you", and a surface that showed the second as the
   * first would report a confident nothing about something it never looked at.
   *
   * Each Record derives these from its OWN vocabulary. The engine may never ask what a particular
   * tool's handoff is CALLED — doing that is exactly the mistake these fields exist to end: the
   * mirror once counted handoffs by looking for tools literally named `Task`/`Agent`/`Skill`, which
   * silently discarded every one an assistant that used other words had recorded.
   */
  delegationCount?: number;
  skillCount?: number;
  /**
   * WHO stopped it: 'user-rejected' (the person refused) or 'automode-blocked' (the SYSTEM blocked
   * it — not them). The two-value semantic is the contract; each Record maps its tool's own
   * vocabulary into it, and reading a system block as a person's refusal would put a friction the
   * person never felt into their own profile.
   */
  denial?: string;
  /** WHICH tools that denial refused, resolved back to names by the Record. Absent when nothing
   *  resolves — an unattributable refusal is recorded as unattributed, never guessed at. */
  deniedTools?: string[];
  /** images carried by this turn */
  images: number;
}

/** Longer than this and it is pasted, not typed: it still counts as a message, but it must never
 *  reach a length statistic. An uncapped p95 read 1,024 words; the capped one reads 78. */
export const PASTE_BOUND = 2000;

/** A working day runs 04:00 → 04:00 local. Splitting at midnight cuts a past-midnight session in
 *  half and reports someone who stops at 00:37 as stopping at 03:35. */
export const DAY_START_HOUR = 4;

/** Which local day does this instant belong to, with the 04:00 boundary applied? YYYY-MM-DD. */
export function dayKey(ts: string | Date): string {
  const d = new Date(ts);
  const shifted = new Date(d.getTime() - DAY_START_HOUR * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getFullYear()}-${p(shifted.getMonth() + 1)}-${p(shifted.getDate())}`;
}

/** A message the person actually submitted: typed prose, not an interrupt, not machine traffic. */
export function isTypedMessage(t: Turn): boolean {
  return t.role === 'user' && !t.interrupted && t.text.length > 0;
}

/**
 * HOW MUCH OF THE CONVERSATION A TOOL WROTE DOWN — and therefore what the profile is allowed to say.
 *
 * Not every assistant records both sides. The rule this exists to enforce is already the engine's
 * rule elsewhere: THE ABSENCE OF A FIELD IS NEVER THE ABSENCE OF THE EVENT. A tool that never
 * records refusals must produce a profile that stays silent about refusals, not one that reports
 * zero of them.
 *
 *   text      — what the person typed. Categories, counts, register, one-sided trends.
 *   interrupt — + course corrections, the distress split, lift.
 *   tools     — + what the assistant was doing, and which action answers which ask.
 *   both      — + refusals: the scoreboard's declines, and any verdict needing the other side.
 */
export type Tier = 'text' | 'interrupt' | 'tools' | 'both';

/** One session's clean turns, batched per conversation because pairing must never cross one. */
export interface Session {
  /** where it came from — a file path, or whatever the tool's unit of storage is */
  path: string;
  session: string;
  turns: Turn[];
  /**
   * WHICH RECORD PRODUCED THIS — stated by the reader that parsed it, never inferred downstream.
   *
   * The engine is tool-blind and stays that way; this is not for it. It is for the one question that
   * IS per-assistant: LIFT grades an AI, so a verdict has to know whose turns it was earned on. The
   * alternative was sniffing a path or a filename prefix, which is the fragile convention the seam
   * exists to prevent — and it is genuinely wrong for archived files, where two Records' slices live
   * under one root.
   */
  record: string;
}

/** The alarm for the one failure that would end this product silently: the tool changes its format,
 *  the reader quietly yields nothing, and a profile gets built describing a person it never saw. */
export interface DriftReport {
  ok: boolean;
  /** the person's own (non-machine) transcript files on disk */
  files: number;
  /** their total bytes */
  bytes: number;
  /** typed human turns the Record extracted (0, or 1 as soon as one is found) */
  typed: number;
  /** set only when ok === false: what to tell the person, and why stratless refuses */
  reason?: string;
}

/**
 * THE RECORD — one assistant's history, read.
 *
 * Everything format-specific lives behind this: finding the files, parsing them, and the hygiene
 * that decides what counts as the person talking. That last part is the expensive half and it is
 * never guessable from documentation — each tool has its own ways of writing things down that were
 * never the person (our own borrowed calls, subagents, harness injections, replays of resumed
 * sessions, superseded drafts). Every one of those was found by getting it wrong on a real archive
 * first, which is why a Record does not ship until it has been run against weeks of real use.
 */
export interface RecordAdapter {
  /** stable id, e.g. 'claude-code' */
  readonly id: string;
  /** what to call it when talking to the person, e.g. 'Claude Code' */
  readonly displayName: string;
  /** how much of the conversation this tool writes down — what the profile may claim */
  readonly tier: Tier;
  /** is this assistant present on this machine? */
  detect(): boolean;
  /** where its history lives, computed at call time — never frozen at import, so a test can point
   *  it somewhere else without forking a subprocess */
  roots(): string[];
  /** its sessions, newest first, one conversation at a time */
  sessions(roots?: string[]): Generator<Session>;
  /** one file's clean turns — the named seam for parsing a single transcript */
  turnsOf(path: string, seen?: Set<string>): Turn[];
  /** the format-drift canary for THIS tool */
  health(roots?: string[]): DriftReport;
  /** session titles the harness already wrote, where the tool writes them. Optional by nature: a
   *  tool without them is not broken, and the surfaces that use them simply say less. */
  titles?(dir: string): { aiTitle: string; sessionId: string }[];
}

/**
 * WHETHER THE AFTER-SESSION REFRESH IS ACTUALLY LIVE.
 *
 * Three states, not two, and the third one was learned rather than designed. Some tools accept a
 * hook the moment it is written; others treat a newly written hook as untrusted and refuse to run
 * it until the PERSON approves it inside the tool itself. Both are correct behaviour, and the
 * difference is invisible from the file we wrote — Codex silently skips an unapproved hook, with
 * nothing on stdout or stderr to say so.
 *
 * So "we wrote the file" and "it will run" are different claims, and this type keeps them apart:
 *
 *   armed             — it will fire. Only this counts as consent to refresh.
 *   awaiting-approval — written, and inert until the person says yes in their own tool.
 *   off               — not installed.
 */
export type ArmState = 'armed' | 'awaiting-approval' | 'off';

/** What protecting a tool's history did, where the tool has history worth protecting. */
export interface ProtectResult {
  copied: number;
  skipped: number;
  /**
   * The tool deletes its own history on a timer, and we turned that off — `before` and `after` as
   * the person should see them.
   *
   * ABSENT where the tool has no such timer, which is not the same as a timer of zero: Claude Code
   * reaps transcripts after 30 days and Codex never reaps at all, so a narrator that printed a
   * "reaper" row for both would be inventing a rescue that never happened.
   */
  reaper?: { before: string; after: string };
}

/**
 * THE RHYTHM — how stratless keeps up with a tool without the person doing anything.
 *
 * "Install = alive" is a property of this leg: the after-session signal is what makes the profile
 * refresh itself instead of being a chore someone remembers. Where a tool offers no such signal the
 * fallback is a scheduler or a manual command — correct, but more work for the person, which the
 * product counts as a failure rather than an inconvenience.
 *
 * ARMING IS NOT CONSENT-GRANTING. Where a tool gates hooks behind its own trust prompt, that prompt
 * is the person's to answer and ours to leave alone: writing the tool's own trust record ourselves
 * would forge a consent inside software we do not own. We write the hook and report honestly that
 * it is pending.
 */
export interface RhythmAdapter {
  /** install the after-session refresh, and report what ACTUALLY happened — writing the file is
   *  not the same as the hook being live. */
  arm(): ArmState;
  /** the current truth, read from the tool's own config rather than from our memory of writing it */
  state(): ArmState;
  /** The true off switch. Warnings describe consequences caused by removing this tool's hook; they
   *  are returned by the adapter so generic CLI code never has to understand tool-specific trust. */
  disarm(): { removed: boolean; warnings: string[] };
  /** stop the tool's own reaper, or keep our copy, where its history would otherwise expire */
  protect?(): ProtectResult;
}

/**
 * WHAT A CALL IS FOR, rather than which model answers it.
 *
 * The three paid moments in a build ask for the same thing — recognise a pile, word a row — so
 * they name a ROLE and each Brain maps it to whatever it actually runs. Naming a model here
 * (`'sonnet'`) would put one provider's product catalogue in the middle of the engine, which is
 * the same mistake tool names were.
 */
export type BrainRole = 'main';

/** What a Brain reports about a call it made. Every field optional: a provider reports what it
 *  reports, and a missing number is unknown, never zero. */
export interface BrainCost {
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  /** the model that ACTUALLY ran — the role we asked for is never a guarantee */
  model?: string;
  /**
   * WHAT IT COST OF THEIR ALLOWANCE, where the provider says so. On a subscription this is the
   * real currency and dollars are the approximation — Codex reports it directly, Claude does not.
   */
  usedPercent?: number;
  windowMinutes?: number;
  resetsAt?: number;
  planType?: string;
}

export interface BrainAnswer {
  text: string;
  cost?: BrainCost;
  /** no receipt came back, so the ledger records "a call happened whose cost I cannot see" rather
   *  than a confident zero */
  unmetered?: boolean;
}

/**
 * THE BRAIN — the borrowed model that names piles and words rows.
 *
 * PROVIDER-bound, never tool-bound, and that distinction is load-bearing rather than tidy: you
 * pick one brain, and it can read ANY assistant's history. Putting a brain on an `Adapter` would
 * break the commonest machine there is — one that reads a second assistant's transcripts using
 * the first assistant's model.
 *
 * Two invariants every implementation must satisfy in its own vocabulary, both learned the hard
 * way and neither optional:
 *
 *  · NO HANDS. The borrow asks a question; it never gets to act. A borrowed model once read a
 *    prompt about writing a file as an instruction to write it, and returned permission chatter
 *    instead of the artifact. Where the switch cannot be guaranteed, refuse loudly rather than
 *    run quietly.
 *  · BLANK SLATE. It must arrive knowing nothing about this person — no instruction files, no
 *    memory, no session to resume. Otherwise it reads the profile it is helping to write, and the
 *    profile confirms itself: measured drift toward flattery, and the blank-slate run surfaced a
 *    finding about where the person got lost that the informed run did not. It is also what makes
 *    "the same method for every user" literally true rather than aspirational.
 */
export interface Brain {
  /** stable id, e.g. 'claude' */
  readonly id: string;
  /** what to call it when talking to the person, e.g. 'Claude Code' */
  readonly displayName: string;
  /** is this brain usable on this machine right now? */
  detect(): boolean;
  /** ask one question and get the answer, or undefined if it could not or would not answer */
  ask(input: string, opts: { role: BrainRole; feature: string; timeoutMs: number; schema?: string }): BrainAnswer | undefined;
}

/**
 * THE RETURN — get the finished profile in front of this assistant.
 *
 * The last leg, and the only one the person feels directly: everything upstream is machinery for
 * this. There is ONE artifact (`profile.ts` owns it) and each assistant has its own way of being
 * made to read it — an import line, a copied block, a path in a config. What differs between them
 * is not just the syntax but the GUARANTEE: a pointer refreshes itself when the profile is rebuilt,
 * a copy is stale the moment the next build lands. Callers must therefore re-`load()` after every
 * build rather than only at install, which costs a pointer implementation nothing and is the whole
 * correctness story for a copy.
 *
 * Only what is between our markers is ever ours. The person's own instructions, in their own file,
 * are untouchable — we are a guest in a file they wrote.
 */
export interface LoadAdapter {
  /** Deliver the profile. Returns the file written, or undefined when there was no profile to
   *  deliver — silence rather than an empty block in someone's config. */
  load(): string | undefined;
  /** Is the profile reaching this assistant right now? */
  loaded(): boolean;
  /** Take it back out, leaving everything the person wrote exactly as it was. True iff something
   *  was actually removed. */
  unload(): boolean;
}

/** One assistant, as stratless sees it. The Brain is absent BY DESIGN — it is provider-bound and
 *  lives in `brains/registry.ts`; see the header. */
export interface Adapter {
  readonly id: string;
  readonly displayName: string;
  readonly record: RecordAdapter;
  readonly rhythm: RhythmAdapter;
  readonly load: LoadAdapter;
  /** THE PACK LEG — where this tool's own skill machinery discovers skill files. The sitting
   *  installs a pair's tune here and nowhere else (pack-only, 2026-08-11); per-tool because each
   *  assistant owns its own door (measured: ~/.claude/skills and ~/.codex/skills both discover
   *  an externally written <name>/SKILL.md with no approval step, codex-cli 0.147.0 probe). */
  skillsDir(): string;
}
