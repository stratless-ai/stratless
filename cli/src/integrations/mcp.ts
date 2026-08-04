/**
 * MCP — serve the profile over the Model Context Protocol, on stdio, to any client that speaks it.
 *
 * WHY THIS EXISTS. Reaching an assistant means getting the profile in front of it before it answers.
 * For Claude Code we do that by writing a file it already loads. Every other tool loads a DIFFERENT
 * file, in a different place, with different size limits and markers — so one adapter per tool,
 * forever. MCP collapses that axis: one protocol, one server, and any client that speaks it gets the
 * profile without us knowing anything about its file conventions. This is the Return leg of the
 * adapter seam, done once. It does NOT read anyone's transcripts — reading is per-tool and stays so.
 *
 * TWO RUNGS, AND THE SPLIT IS MEASURED, NOT PREFERRED (2026-07-30):
 *
 *   · `instructions` on the initialize response reaches the model with no tool call and no decision
 *     on its part — the only true connect-time channel. Measured: it lands in Claude Code, and it is
 *     TRUNCATED AT EXACTLY 2048 CHARACTERS. A 4.7KB profile lost 56% of itself mid-row. A profile cut
 *     mid-instruction is worse than no profile, so this rung carries a short, COMPLETE hook — never
 *     the profile. Budgeted under 1024 because that is where other clients have been seen to cut
 *     (Creed's own instructions sit at 985 characters, engineered under the same wall).
 *   · `who_am_i` returns the whole profile, with no size limit worth worrying about. Tool schemas are
 *     injected by every client, so this rung works even where instructions are ignored (Claude
 *     Desktop stores that field and never reads it).
 *
 * READ-ONLY, ONE TOOL. Nothing here mutates anything: no write tool, no proposal, no approval mode.
 * That is not restraint, it is the architecture — the profile is derived by arithmetic from the
 * person's own history, so there is nothing for a model to edit. A competitor whose model IS the
 * capture mechanism needs seventeen CRUD tools and a benchmark to check whether models can drive
 * them; we need one verb and no benchmark.
 *
 * ZERO DEPENDENCIES. MCP over stdio is line-delimited JSON-RPC, so the whole surface is four methods
 * and no SDK. `cli/` stays dependency-free, which is the audit argument the product rests on.
 *
 * STDOUT IS THE PROTOCOL. Every diagnostic goes to stderr. One stray `console.log` would be parsed
 * as a malformed frame and break the session.
 */
import { createInterface } from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { humanMdPath, profilePath } from '../storage/profile.js';
import { registry } from './assistants/registry.js';

/** The protocol version we answer with when a client does not name one. */
const FALLBACK_PROTOCOL = '2025-06-18';

/** Measured ceiling on the `instructions` field (Claude Code, 2026-07-30): a hard 2048 characters.
 *  We budget to half of it, so a client with a tighter cut still receives a whole sentence. */
export const HOOK_BUDGET = 1024;

/**
 * The connect-time hook. Says what the server is and asks for one call — deliberately NOT the
 * profile itself, because this channel truncates and a half-instruction is a wrong instruction.
 */
export function hook(): string {
  const text = [
    'This server carries a profile of the person you are talking to: how they work, what to offer them before they ask, what to catch for them, and the register they use.',
    'Call who_am_i at the start of the conversation and before any substantive work, then let the profile shape your first answer rather than a later one.',
    'The profile describes the person and instructs you about them. It is derived from their own history by arithmetic, never declared by them.',
  ].join(' ');
  // A hook that overran its own budget would be cut mid-sentence — the failure it exists to avoid.
  return text.length <= HOOK_BUDGET ? text : `${text.slice(0, HOOK_BUDGET - 1)}…`;
}

/**
 * FRONT-LOADED ON PURPOSE — the instruction first, the elaboration last (measured 2026-07-31).
 *
 * Claude Desktop does not put tool descriptions in the model's context. It keeps a DEFERRED INDEX:
 * a ~80-character clipped preview, from which the model decides whether the tool is worth loading at
 * all. The first draft of this string opened by describing the contents and closed with "Call this at
 * the start of a conversation" — so on that client the only sentence that would make a model ACT was
 * the sentence that got cut. It called the tool solely because the person asked it to.
 *
 * The rule, which is the 2048-character truncation lesson in a second place: EVERY channel truncates,
 * and they all truncate the tail. Whatever must survive goes first.
 */
export const TOOL = {
  name: 'who_am_i',
  description:
    'Call this first, before any substantive work: it returns the profile of the person you are talking to, so your first answer already fits them rather than a later one. It covers how they work, what to offer them before they ask, what to catch for them, and the register they use.',
  inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
};

/**
 * The profiles as they stand right now, read at call time so a rebuild is live everywhere with
 * nothing to re-inject. Refuses honestly when there is nothing built: silence beats inventing a
 * person.
 *
 * EVERY PAIR'S PROFILE, EACH LABELLED WITH THE RELATIONSHIP IT WAS MEASURED IN. An MCP client is a
 * tool stratless loads into but has never read — a pair with no history — so it gets no unlabelled
 * profile at all: handing Cursor a file measured in Claude Code as if it were about Cursor is the
 * exact cross-pair claim the per-record split removed. Labelled, the consumer knows precisely what
 * it is holding: how this person works with each assistant stratless CAN read, and that none of it
 * was measured here. The merged-era file serves the interim between an upgrade and the rebuild.
 */
export function profileText(file?: string): { text: string; isError: boolean } {
  const readOne = (path: string): string | undefined => {
    try {
      const raw = readFileSync(path, 'utf8').trim();
      return raw || undefined;
    } catch {
      return undefined;
    }
  };

  // An explicit file (tests, and the legacy serve path) keeps the single-file behaviour.
  if (file) {
    if (!existsSync(file)) {
      return {
        text: 'No profile has been built yet on this machine. Ask the person to run `stratless update`, and treat them as unknown until then rather than guessing.',
        isError: true,
      };
    }
    const raw = readOne(file);
    if (!raw) return { text: 'The profile file exists but is empty. Treat the person as unknown.', isError: true };
    return { text: raw, isError: false };
  }

  const parts: string[] = [];
  for (const a of registry) {
    const path = profilePath(a.record.id);
    if (!existsSync(path)) continue;
    const raw = readOne(path);
    if (raw) parts.push(`# As observed working with ${a.displayName}\n\n${raw}`);
  }
  if (parts.length) {
    return {
      text: `${parts.join('\n\n---\n\n')}\n\n---\nEach section above was measured inside ONE assistant's own history. None of it was measured with you — read it as how this person works with those tools, not as a claim about this conversation.`,
      isError: false,
    };
  }
  const legacy = existsSync(humanMdPath()) ? readOne(humanMdPath()) : undefined;
  if (legacy) return { text: legacy, isError: false };
  return {
    text: 'No profile has been built yet on this machine. Ask the person to run `stratless update`, and treat them as unknown until then rather than guessing.',
    isError: true,
  };
}

type Req = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

/**
 * Answer one request. Pure over its input (the profile file is the one read), so the whole protocol
 * surface is testable without spawning a process or a client.
 *
 * Returns null for notifications — a JSON-RPC notification carries no id and MUST NOT be answered.
 */
export function handle(req: Req, file?: string): object | null {
  const { id, method, params } = req;
  const ok = (result: object): object => ({ jsonrpc: '2.0', id, result });

  if (method === 'initialize') {
    const asked = params?.protocolVersion;
    return ok({
      // Echo the client's version rather than pinning ours: this server has no version-specific
      // behaviour, so refusing a handshake over a number would fail for the wrong reason.
      protocolVersion: typeof asked === 'string' && asked ? asked : FALLBACK_PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: 'stratless', version: 'profile' },
      instructions: hook(),
    });
  }
  if (method === 'tools/list') return ok({ tools: [TOOL] });
  if (method === 'tools/call') {
    if (params?.name !== TOOL.name) {
      return ok({ content: [{ type: 'text', text: `stratless serves one tool: ${TOOL.name}` }], isError: true });
    }
    const { text, isError } = profileText(file);
    return ok({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) });
  }
  // Declared empty rather than left unimplemented: a client that lists them should get an answer,
  // not an error it has to interpret.
  if (method === 'resources/list') return ok({ resources: [] });
  if (method === 'prompts/list') return ok({ prompts: [] });
  if (method?.startsWith('notifications/')) return null;
  if (id === undefined || id === null) return null;
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `stratless does not implement ${method}` } };
}

/** Run the server until stdin closes. Resolves with the exit code. */
export function serve(input: NodeJS.ReadableStream = process.stdin, out: NodeJS.WritableStream = process.stdout): Promise<number> {
  return new Promise((resolve) => {
    const rl = createInterface({ input });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      let req: Req;
      try {
        req = JSON.parse(line) as Req;
      } catch {
        // A malformed frame has no id to answer against, so there is nobody to tell. Dropping it
        // keeps the session alive; crashing would take the person's whole assistant down with us.
        return;
      }
      const res = handle(req);
      if (res) out.write(`${JSON.stringify(res)}\n`);
    });
    rl.on('close', () => resolve(0));
  });
}
