/**
 * NAME — the only stage that spends, and the only judgement in the engine.
 *
 * Clustering finds the crowds; this says what each one IS. It is the whole of the model's job in v3:
 * the LLM sits at the END of the pipeline (naming, writing), never in the MIDDLE (matching). That is
 * a cost property — $20.40 of matching became $0 of arithmetic — but it is more importantly a TRUTH
 * property. A model that INVENTS categories can always be steered by its prompt into finding what
 * the prompt asked for; a model that only NAMES what the evidence already grouped cannot.
 *
 * That is not theoretical. Measured 2026-07-25/26: the same model on the same sample produced 27
 * general behaviours or 11 judgment moves depending only on how the discovery prompt was worded, and
 * a hand read found those judgment categories were the least accurate the engine ever produced (23%
 * and 33%). A whole section of the shipped profile existed largely because a prompt requested it.
 * Nothing here can do that — the piles arrive already formed, and the call can only describe them.
 *
 * THREE JOBS, one call:
 *   NAME   what is this move?
 *   SCOPE  person (how they work, portable) or project (a subject) — LOAD-BEARING: `write.ts` drops
 *          project-scoped categories, and without this field topic piles flood the profile.
 *   MERGE  are two piles the same move in different words? The clustering splits a behaviour across
 *          piles when the person phrases it several ways.
 *
 * THINKING IS OFF. Measured: identical structural quality, 3.3x cheaper, 4.4x faster. Merging is
 * genuine reasoning when there are many piles to hold at once, but at a derived K the piles are
 * already close to one-behaviour-each and there is little left to reason about.
 *
 * NOTE: `MAX_THINKING_TOKENS` is a BUDGET, not a ceiling — measured unset 443 output tokens, `0` 232,
 * `8000` 590. Setting a number ABOVE the default RAISES thinking. Only `0` suppresses it.
 *
 * --safe-mode rides on every borrowed call, so the person's own HUMAN.md is never in context while
 * their profile is being derived ([[borrowed-calls-load-human-md]]).
 */
import { runClaude } from './claude.js';
import type { Moment } from './moments.js';
import type { Pile } from './cluster.js';

/** How many members represent a pile to the model. Four is enough to recognise a move; more is paid
 *  input for no extra judgement. */
const SHOWN = 4;
/** Naming reads a few thousand tokens and answers briefly; it does not need the assign-era window. */
const TIMEOUT_MS = 300_000;

/** One behaviour, as the model returns it. `piles` is how it merges — several ids, one behaviour. */
export interface Named {
  name: string;
  description: string;
  scope: 'person' | 'project';
  quote: string;
  piles: number[];
}

const SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          scope: { type: 'string' },
          quote: { type: 'string' },
          piles: { type: 'array', items: { type: 'number' } },
        },
        required: ['name', 'description', 'scope', 'quote', 'piles'],
      },
    },
  },
  required: ['groups'],
});

const clip = (s: string, n: number): string => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * Render one pile for the model. It sees the person's REAL words — never the shaped text the
 * clustering ran on. Grouping wants the move stripped of its subject; naming wants real language, or
 * the model is reading rubble. Different jobs, different inputs.
 *
 * The structural marks ride along because they are free and they carry meaning no text does: a pile
 * that is mostly interruptions is a different kind of move from one that is not.
 */
function render(pile: Pile, moments: Moment[]): string {
  const ms = pile.members.map((i) => moments[i]).filter(Boolean);
  const anchors = ms.filter((m) => m.pile !== 'ordinary').length;
  const conversations = new Set(ms.map((m) => m.session)).size;
  const lines = [`### PILE ${pile.id} — ${ms.length} moments across ${conversations} conversations`];
  if (anchors) lines.push(`(${anchors} of them interrupted the assistant or declined a tool)`);
  const seen = new Set<string>();
  for (const m of ms) {
    const r = clip(m.reply, 240);
    if (r.length < 3 || seen.has(r)) continue;
    seen.add(r);
    lines.push(`  "${r}"`);
    if (seen.size >= SHOWN) break;
  }
  return lines.join('\n');
}

function prompt(piles: Pile[], moments: Moment[]): string {
  return `Below are ${piles.length} piles of things one person typed to an AI coding assistant. They were grouped by how they were phrased, so each pile should already be one recognisable thing the person DOES.

For each pile, give:

1. **name** — short kebab-case, for what the PERSON DID. An act, not a topic, not a personality trait.
2. **description** — one sentence, written so an AI assistant reading it would recognise this move the next time it happens.
3. **scope** — "person" if it is how this human works (it would still be true on a different project); "project" if the pile is really held together by a particular subject rather than by an act.
4. **quote** — one short phrase copied VERBATIM from a line in that pile, that shows the move.
5. **piles** — the pile ids this behaviour covers.

If two piles are unmistakably the same move phrased differently, put both ids in one group. Otherwise leave each on its own — they were separated for a reason.

Every pile id must appear exactly once. Judge only from the evidence shown; do not invent moves that are not in these piles.

${piles.map((p) => render(p, moments)).join('\n\n')}`;
}

/**
 * Name every pile in one call. Returns [] when the assistant is unavailable or the reply is
 * unusable — refuse, don't lie: a build with no names writes no profile, which is the honest outcome.
 */
export function namePiles(bin: string, piles: Pile[], moments: Moment[]): Named[] {
  if (!piles.length) return [];
  const raw = runClaude(bin, prompt(piles, moments), 'sonnet', 'name', TIMEOUT_MS, SCHEMA, 0);
  if (!raw) return [];
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]) as { groups?: unknown };
    if (!Array.isArray(parsed.groups)) return [];
    return validate(parsed.groups as Named[], piles);
  } catch {
    return []; // unparseable — no profile beats a wrong one
  }
}

/**
 * The contract, enforced in code rather than hoped for: every pile claimed exactly once.
 *
 * A pile claimed TWICE would double-count its moments, inflating the very numbers that are the
 * profile's receipt. A pile claimed by NOBODY would silently drop real evidence. Both are repaired
 * here — first claim wins, unclaimed piles are dropped rather than guessed at — because a model
 * asked for a partition will occasionally return something that is nearly one.
 */
function validate(groups: Named[], piles: Pile[]): Named[] {
  const known = new Set(piles.map((p) => p.id));
  const claimed = new Set<number>();
  const out: Named[] = [];
  for (const g of groups) {
    if (!g?.name || !Array.isArray(g.piles)) continue;
    const ids = g.piles.filter((id) => known.has(id) && !claimed.has(id));
    if (!ids.length) continue; // every pile it claimed was already taken — it is a duplicate group
    for (const id of ids) claimed.add(id);
    out.push({
      name: String(g.name).trim(),
      description: String(g.description ?? '').trim(),
      scope: g.scope === 'project' ? 'project' : 'person',
      quote: String(g.quote ?? '').trim(),
      piles: ids,
    });
  }
  return out;
}
