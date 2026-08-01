/**
 * THE CODEX BRAIN — `codex exec` as a borrow, so a person who runs only Codex gets a real profile.
 *
 * Until this existed, someone without Claude Code installed could have their whole history read
 * correctly and then hit a wall: the naming call had no binary, so no piles were ever named and no
 * profile was ever written. Their assistant was supported for reading and not for thinking, which
 * is not support.
 *
 * THE TWO INVARIANTS, SATISFIED IN CODEX'S OWN VOCABULARY (see `seam.ts`'s `Brain`):
 *
 *  · NO HANDS. Codex has no `--tools ""`. What it has is better in one way and weaker in another,
 *    and the difference is worth stating rather than smoothing over. Three things stack here:
 *    `--sandbox read-only` (the default for exec, and enforced by the OS rather than by the model
 *    agreeing — on macOS the kernel refuses the write), nothing to ask (exec is
 *    non-interactive, so it cannot escalate out of that), and an EMPTY working directory (nothing local to look at). Stronger
 *    than a flag because it does not depend on the flag being honoured; weaker because the model
 *    still HAS hands, they simply cannot write. A Codex borrow could in principle read a file; a
 *    Claude borrow cannot. That is in the privacy page, not buried here.
 *
 *  · BLANK SLATE. Codex has no single "safe mode" either, and its instruction files are exactly
 *    the hazard the Claude side found the hard way: `~/.codex/AGENTS.md` would be where a person's
 *    own profile is loaded from, so a borrowed call would read the file it is helping to write and
 *    quietly confirm itself. `CODEX_HOME` pointed at a scratch directory removes the global file,
 *    the empty `-C` directory removes any project one, and `--skip-git-repo-check` keeps it from
 *    objecting to a directory with no repository. `auth.json` is linked into the scratch home so
 *    the borrow still rides the person's subscription — the same trap `--bare` set on the Claude
 *    side, where the switch that blanked the memory also demanded an API key and killed the borrow.
 *
 * WHAT IT REPORTS — measured against 0.146.0's actual stream rather than assumed. Four frame types
 * come back (`thread.started`, `turn.started`, `item.completed`, `turn.completed`), and the last of
 * them carries the receipt: input, cached-input, cache-write, output and reasoning tokens. That is
 * ALL it carries. No dollars, which is honest for a subscription — nobody is billed for this call.
 * No model id and no quota reading either, though an interactive Codex session records both in its
 * own rollouts; the exec stream is leaner than the transcript. So `model` and the allowance fields
 * stay absent here rather than filled with what we ASKED for, because `byModel` exists to say what
 * actually ran and our request was never a guarantee. The parse below still reads them if a future
 * version starts sending them.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { onPath } from './brain-claude-code.js';
import { codexHome } from './record-codex.js';
import { recordUsage } from './usage.js';
import type { Brain, BrainAnswer, BrainCost } from './seam.js';

/** Where the person's real Codex lives — read for auth only, never as the borrow's home. */
const realCodexHome = codexHome;

/**
 * Read-only is already `codex exec`'s default; passing it makes the guarantee explicit rather than
 * inherited, so a future default change cannot silently loosen the borrow.
 *
 * There is no approval flag to pass here: `--ask-for-approval` is interactive-mode only and `exec`
 * rejects it outright (verified against 0.146.0). Non-interactive runs report `approval: never`,
 * which is the property we need — a borrowed call cannot ask to escalate out of the sandbox,
 * because there is nobody to ask.
 */
const NO_HANDS = ['--sandbox', 'read-only'] as const;

/** What Codex's `--json` event stream says about the call. */
interface StreamRead {
  text: string;
  cost: BrainCost;
  errored: boolean;
}

/**
 * ASSEMBLE THE ANSWER FROM THE STREAM.
 *
 * `codex exec --json` emits one JSON object PER LINE — thread started, turn started, items
 * completed, turn completed — not a single envelope like `claude -p --output-format json`. So the
 * reply is gathered rather than parsed: the last agent message is the answer, the usage on the
 * completed turn is the receipt, and an `error` event means refuse rather than return prose.
 *
 * A line that does not parse is skipped rather than fatal: the stream is a log, and one malformed
 * frame is not a reason to throw away a good answer.
 */
export function readStream(raw: string): StreamRead {
  let text = '';
  const cost: BrainCost = {};
  let errored = false;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== '{') continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = String(ev.type ?? '');
    if (type === 'error') {
      errored = true; // an error frame is a refusal, never an answer
      continue;
    }
    // The assistant's own words arrive as a completed item; the LAST one is the reply.
    const item = ev.item as Record<string, unknown> | undefined;
    if (item && String(item.type ?? '') === 'agent_message' && typeof item.text === 'string') text = item.text;
    if (typeof ev.text === 'string' && String(ev.item_type ?? '') === 'agent_message') text = ev.text;

    const usage = (ev.usage ?? (ev.info as Record<string, unknown> | undefined)?.total_token_usage) as
      | Record<string, unknown>
      | undefined;
    if (usage) {
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
      cost.inputTokens = num(usage.input_tokens) ?? cost.inputTokens;
      cost.outputTokens = num(usage.output_tokens) ?? cost.outputTokens;
      cost.cacheReadTokens = num(usage.cached_input_tokens) ?? cost.cacheReadTokens;
      cost.cacheCreationTokens = num(usage.cache_write_input_tokens) ?? cost.cacheCreationTokens;
    }
    // The allowance read — what this cost of their window, which on a subscription is the real
    // currency. Absent for a provider that does not say, which is not the same as zero.
    const limits = ev.rate_limits as Record<string, unknown> | undefined;
    const primary = limits?.primary as Record<string, unknown> | undefined;
    if (primary) {
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
      cost.usedPercent = num(primary.used_percent) ?? cost.usedPercent;
      cost.windowMinutes = num(primary.window_minutes) ?? cost.windowMinutes;
      cost.resetsAt = num(primary.resets_at) ?? cost.resetsAt;
    }
    if (typeof limits?.plan_type === 'string') cost.planType = limits.plan_type;
    if (typeof ev.model === 'string') cost.model = ev.model;
  }

  return { text: text.trim(), cost, errored };
}

/** Bigger than the Claude borrow's, because an event stream carries a frame per item on top of the
 *  answer — and an exceeded buffer throws, which the caller would swallow into silence. */
const MAX_BUFFER = 32 * 1024 * 1024;

export const codexBrain: Brain = {
  id: 'codex',
  displayName: 'Codex',
  detect: () => onPath('codex'),

  ask(input, opts): BrainAnswer | undefined {
    if (!onPath('codex')) return undefined;

    const root = mkdtempSync(join(tmpdir(), 'stratless-borrow-'));
    const home = join(root, 'home');
    const work = join(root, 'work');
    try {
      mkdirSync(home, { recursive: true });
      mkdirSync(work, { recursive: true });
      // Carry the credential so the borrow rides their subscription; nothing else comes across, so
      // no AGENTS.md, no config, no memory, no sessions.
      const auth = join(realCodexHome(), 'auth.json');
      if (existsSync(auth)) {
        try {
          symlinkSync(auth, join(home, 'auth.json'));
        } catch {
          copyFileSync(auth, join(home, 'auth.json')); // a platform without symlinks still borrows
        }
      }

      const args = [
        'exec',
        '--json',
        ...NO_HANDS,
        '--skip-git-repo-check',
        '-C',
        work, // an empty room: nothing local for a read-only pair of hands to find
        ...(opts.schema ? ['--output-schema', writeSchema(home, opts.schema)] : []),
        input,
      ];

      const childEnv: Record<string, string | undefined> = { ...process.env, CODEX_HOME: home };
      delete childEnv.STRATLESS_FLUSH; // our consent signal must never ride into a borrowed session

      const raw = execFileSync('codex', args, {
        encoding: 'utf8',
        env: childEnv,
        timeout: opts.timeoutMs,
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: MAX_BUFFER,
      });

      const read = readStream(raw);
      if (read.errored || !read.text) return undefined; // refuse, never return an error as an answer
      recordUsage({ ...read.cost, feature: opts.feature, ...(read.cost.model ? { byModel: { [read.cost.model]: read.cost } } : {}) });
      return { text: read.text, cost: read.cost };
    } catch {
      return undefined; // no binary, a timeout, a refusal — the caller degrades to silence
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
};

/**
 * Codex takes a schema as a FILE rather than a string, so it lands in the scratch home and dies
 * with it — and it is tightened on the way.
 *
 * OpenAI's structured output runs in strict mode: EVERY object must say
 * `additionalProperties: false`, or the request is rejected outright with `invalid_json_schema`
 * before the model ever sees it. Claude has no such rule, so a schema written for one brain and
 * handed to the other fails at the API rather than in our code — and because a borrowed call's
 * stderr is discarded, it fails as silence.
 *
 * Ours already comply. This walks them anyway, because the failure mode is invisible and the next
 * person to add a schema will not know the rule: better that their loose schema quietly works than
 * that one brain stops naming anything and nobody can see why.
 */
function writeSchema(home: string, schema: string): string {
  const path = join(home, 'schema.json');
  let body = schema;
  try {
    body = JSON.stringify(strict(JSON.parse(schema)));
  } catch {
    /* unparseable is the caller's problem, not ours to rewrite */
  }
  writeFileSync(path, body);
  return path;
}

/** Every object in the tree closed to extra fields, recursively. */
function strict(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strict);
  if (!node || typeof node !== 'object') return node;
  const o = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = strict(v);
  if (o.type === 'object' && out.additionalProperties === undefined) out.additionalProperties = false;
  return out;
}
