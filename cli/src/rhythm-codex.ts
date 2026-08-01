/**
 * THE CODEX RHYTHM — the after-session refresh, and what "armed" is allowed to mean.
 *
 * Codex fires a `SessionEnd` hook when a session ends, which is the same signal Claude Code's `Stop`
 * hook gives us. Everything below was measured against codex-cli 0.146.0 rather than read from
 * documentation, and three of the findings changed the code.
 *
 * 1. WRITING THE HOOK DOES NOT ARM IT. A newly written hook is SILENTLY SKIPPED — nothing on stdout,
 *    nothing on stderr, it simply never runs. Codex reviews new hooks in its own TUI at startup
 *    ("N hooks are new or changed" → Review / Trust all / Continue without trusting) and records the
 *    grant in the PERSON's `config.toml`. So `arm()` writes the file and honestly reports
 *    `awaiting-approval`; only the person's yes makes it `armed`.
 *
 *    We could write that trust record ourselves. We must not. It is a consent artifact inside
 *    software we do not own, and forging it is the same act as pooling someone's data — the tool
 *    asked them, not us.
 *
 * 2. TRUST IS KEYED BY POSITION, SO WE APPEND AND NEVER INSERT. The grant is stored as:
 *
 *        [hooks.state."/Users/you/.codex/hooks.json:session_end:0:0"]
 *        trusted_hash = "sha256:…"
 *
 *    — `<file>:<event>:<group index>:<handler index>`. Measured both ways on a real install: adding
 *    our group AFTER an existing one leaves theirs trusted ("1 hook is new or changed"); putting
 *    ours FIRST shifts their index and un-trusts their own automation ("2 hooks are new or
 *    changed"). Appending is therefore a correctness rule, not a style choice, and the alternative
 *    fails invisibly — the person would just find Codex re-asking about hooks they already approved.
 *
 * 3. THE HOOK BLOCKS SESSION EXIT, so it must detach. `async` hooks are not supported in this
 *    version (the binary downgrades them to synchronous and clamps the timeout), and a probe hook
 *    that read stdin and waited hung a real session for a full five minutes. Hence the trailing `&`,
 *    exactly as the Claude Stop hook does it.
 *
 * A COROLLARY WORTH KNOWING: because trust is a hash of the hook's config, changing our command
 * re-invalidates it and re-prompts the person. The command string is therefore FROZEN — no version,
 * no absolute path, nothing that drifts between releases.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { atomicWriteFileSync } from './atomic.js';
import { archiveSlice, codexHome } from './record-codex.js';
import type { ArmState, ProtectResult } from './seam.js';

/** Codex's hook config. Discovered automatically — no config.toml key points at it. */
export const hooksPath = (): string => join(codexHome(), 'hooks.json');

/** Where Codex records which hooks the person has approved. */
const configPath = (): string => join(codexHome(), 'config.toml');

/** How we recognise our own entry among the person's. `description` is Codex's own field on a
 *  matcher group, so this needs no marker of our invention. */
const MARK = 'stratless';

/**
 * FROZEN — and this is the one line in the file that must not be edited casually.
 *
 * Trust is a hash over the hook's config, so any edit to this string un-trusts the hook on every
 * machine that already approved it. It does so SILENTLY, and worse than silently: `state()` keeps
 * reporting `armed`, because the trust KEY still exists at our index — only the hash behind it is
 * now stale. The person would be told their refresh is on while Codex quietly skips it.
 *
 * That residual is accepted ONLY because this string never moves. It carries no version, no path,
 * nothing that drifts between releases, and `rhythm-codex.test.ts` pins it exactly so a change is a
 * loud failure rather than a quiet one.
 *
 * IF IT EVER MUST CHANGE, it is a migration and not an edit: rewrite the group in place (same index,
 * so nobody else's trust shifts) and TELL the person Codex will ask them to approve the refresh
 * again. Do not ship a change to this line without that message.
 *
 * The trailing `&` is load-bearing — see the header.
 */
const COMMAND = 'stratless update >/dev/null 2>&1 &';

/** The group we install, and the only thing in the file that is ours. */
const ourGroup = (): unknown => ({
  description: MARK,
  hooks: [{ type: 'command', command: COMMAND }],
});

interface HooksFile {
  hooks?: Record<string, unknown[]>;
  [k: string]: unknown;
}

/**
 * Read the hook config. A hand-edited file must never crash us and must never be silently
 * overwritten — the same doctrine `readSettings` follows for Claude Code, and for the same reason:
 * this is the person's file, holding automation we did not write.
 */
export function readHooks(path: string = hooksPath()): { ok: boolean; doc: HooksFile | undefined } {
  if (!existsSync(path)) return { ok: true, doc: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as HooksFile;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, doc: undefined };
    return { ok: true, doc: parsed };
  } catch {
    return { ok: false, doc: undefined };
  }
}

/** Which SessionEnd group is ours, or -1. Identity is the `description`, never the position — the
 *  position is what TRUST is keyed on, and reading it back from our own file would be circular. */
function ourIndex(doc: HooksFile): number {
  const groups = doc.hooks?.SessionEnd;
  if (!Array.isArray(groups)) return -1;
  return groups.findIndex((g) => (g as { description?: unknown })?.description === MARK);
}

/**
 * Install the after-session refresh — APPENDED, never inserted (see the header: inserting un-trusts
 * the person's own hooks by shifting their index).
 *
 * Idempotent: an entry already there is left exactly where it is, because moving it would change
 * the trust key and undo an approval the person already gave.
 */
export function arm(path: string = hooksPath()): ArmState {
  const read = readHooks(path);
  if (!read.ok || !read.doc) {
    throw new Error(
      `your ${path} is not valid JSON, and stratless will not overwrite a file it cannot read.\nFix it (or move it aside), then try again.`,
    );
  }
  const doc = read.doc;
  if (ourIndex(doc) === -1) {
    doc.hooks ??= {};
    const groups = Array.isArray(doc.hooks.SessionEnd) ? doc.hooks.SessionEnd : [];
    groups.push(ourGroup()); // APPEND — the one rule this file exists to hold
    doc.hooks.SessionEnd = groups;
    mkdirSync(dirname(path), { recursive: true });
    atomicWriteFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  }
  return state(path);
}

/**
 * Is the hook actually going to run?
 *
 * WHAT THIS CAN AND CANNOT SEE, stated because the gap is real: we can tell whether the person has
 * ever approved a hook at our position, because Codex writes a key for it. We CANNOT verify the
 * stored hash still matches, since the hash is over a preimage only Codex knows. That is acceptable
 * only because `COMMAND` is frozen — an entry we wrote and never edit keeps its grant. If that
 * string ever changes, this will report `armed` for one session that Codex actually skips.
 */
export function state(path: string = hooksPath()): ArmState {
  const read = readHooks(path);
  if (!read.ok || !read.doc) return 'off';
  const idx = ourIndex(read.doc);
  if (idx === -1) return 'off';
  return trusted(idx) ? 'armed' : 'awaiting-approval';
}

/**
 * Has the person approved the hook sitting at this position?
 *
 * Read as text rather than parsed as TOML: we only ever ASK about this file, never write it, and a
 * whole TOML parser to answer one yes/no would be a dependency in a package that has none. The key
 * is matched by its tail (`hooks.json:session_end:<group>:0`) rather than the full path, because
 * Codex stores the resolved path and `/tmp` is a symlink to `/private/tmp` on macOS — comparing
 * whole paths would read as "never approved" on a machine where it plainly was.
 */
function trusted(groupIndex: number): boolean {
  try {
    const toml = readFileSync(configPath(), 'utf8');
    return toml.includes(`hooks.json:session_end:${groupIndex}:0"`);
  } catch {
    return false; // no config, no grant
  }
}

/**
 * Take the hook back out, leaving every other hook the person has exactly as it was.
 *
 * Returns whether ours was there to remove. Note for the caller: removing our group shifts the index
 * of anything AFTER it, which un-trusts those hooks. Nothing follows ours at arm time, but a person
 * may have added their own since — `groupsAfterOurs` lets `stop` say so rather than let them
 * discover it as a surprise from Codex.
 */
export function disarm(path: string = hooksPath()): boolean {
  const read = readHooks(path);
  if (!read.ok || !read.doc) return false;
  const doc = read.doc;
  const groups = doc.hooks?.SessionEnd;
  if (!Array.isArray(groups)) return false;
  const kept = groups.filter((g) => (g as { description?: unknown })?.description !== MARK);
  if (kept.length === groups.length) return false;
  doc.hooks!.SessionEnd = kept;
  atomicWriteFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  return true;
}

/** How many of the person's own hooks sit after ours, and would therefore need re-approving if we
 *  removed it. Zero in the ordinary case — we append, so nothing follows us until they add one. */
export function groupsAfterOurs(path: string = hooksPath()): number {
  const read = readHooks(path);
  if (!read.ok || !read.doc) return 0;
  const groups = read.doc.hooks?.SessionEnd;
  const idx = ourIndex(read.doc);
  if (!Array.isArray(groups) || idx === -1) return 0;
  return groups.length - idx - 1;
}

/**
 * Keep a copy of the rollouts.
 *
 * NO REAPER TO STOP — and the narration must not imply one. Claude Code deletes transcripts on a
 * 30-day timer, which is the whole reason `init` exists; Codex was checked for the same and has
 * none. `max_rollout_age_days` in its config belongs to memory extraction, and `codex archive` /
 * `codex delete` are explicit per-session commands the person runs themselves.
 *
 * So this is a copy against a manual delete, not a rescue from a countdown. `reaperStopped` is left
 * ABSENT rather than false, per the seam's rule: absence means "this tool has no such thing".
 */
export function protect(): ProtectResult {
  const src = join(codexHome(), 'sessions');
  const dest = archiveSlice();
  let copied = 0;
  let skipped = 0;

  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue; // vanished mid-walk
      }
      if (st.isDirectory()) {
        walk(p);
        continue;
      }
      if (!name.endsWith('.jsonl')) continue; // a .zst is refused by the reader; do not pretend to keep it
      // Codex nests by date; keep that shape rather than flattening, so the copy reads back through
      // the same walker with no special case.
      const dst = join(dest, relative(src, p));
      try {
        if (existsSync(dst) && statSync(dst).size >= st.size) {
          skipped++;
          continue;
        }
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(p, dst);
        copied++;
      } catch {
        /* one unreadable rollout must not stop the rest */
      }
    }
  };
  walk(src);
  return { copied, skipped };
}
