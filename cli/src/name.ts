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
 * ONE JOB. It used to be three — name, scope (person/project), merge — and the other two were
 * `assign` in miniature: per-pile LLM verdicts sitting in the DATA PATH, deciding what evidence
 * survives. Measured across five builds of the same corpus (2026-07-26), the scope stamp swung
 * 18 → 0 → 0 → 0 → 10 piles binned as "project" — at its worst deleting 71% of the moments,
 * including the person's two most frequent behaviours — and the merge verdict swung 1 → 14 → 2 → 0
 * folds. The arithmetic stages never moved once. So both left the model the same day: merging is now
 * dot products in `cluster.ts` (`mergeOverlapping`), and nothing is scoped at all — `write.ts` keeps
 * its project-filter as a dead-man switch that nothing trips. A badly WORDED name is visible and
 * harmless; a pile silently binned is how a person's 882× signature habit vanished from their own
 * profile. The model keeps the pen; the trash can and the glue stick are code.
 *
 * THINKING IS OFF. Measured: identical structural quality, 3.3x cheaper, 4.4x faster. Describing one
 * pile at a time is recognition, not reasoning.
 *
 * NOTE: `MAX_THINKING_TOKENS` is a BUDGET, not a ceiling — measured unset 443 output tokens, `0` 232,
 * `8000` 590. Setting a number ABOVE the default RAISES thinking. Only `0` suppresses it.
 *
 * --safe-mode rides on every borrowed call, so the person's own HUMAN.md is never in context while
 * their profile is being derived ([[borrowed-calls-load-human-md]]).
 */
import { pickBrain } from './brains.js';
import type { Moment } from './moments.js';
import type { Pile } from './cluster.js';

/** How many members represent a pile to the model. Four is enough to recognise a move; more is paid
 *  input for no extra judgement. */
const SHOWN = 4;
/** Naming reads a few thousand tokens and answers briefly; it does not need the assign-era window. */
const TIMEOUT_MS = 300_000;

/** One behaviour, as the model returns it: a name and a description for exactly one pile. */
export interface Named {
  name: string;
  description: string;
  quote: string;
  pile: number;
}

const SCHEMA = JSON.stringify({
  type: 'object',
  additionalProperties: false,
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          quote: { type: 'string' },
          pile: { type: 'number' },
        },
        required: ['name', 'description', 'quote', 'pile'],
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
  return `Below are ${piles.length} piles of things one person typed to an AI coding assistant. They were grouped by the SHAPE of their phrasing with subject words removed — so each pile should already be one recognisable thing the person DOES, and any vocabulary its lines share is incidental, not what holds it together.

For each pile, give:

1. **name** — short kebab-case, for what the PERSON DID. An act, not a topic, not a personality trait.
2. **description** — one sentence, written so an AI assistant reading it would recognise this move the next time it happens. Keep it as specific as the pile's own evidence — portable is not vague. One rule of register only: if a noun would name this person's current project or product, write the kind of thing it is instead ("their product", "the system"); every other word stays concrete.
3. **quote** — one short phrase copied VERBATIM from a line in that pile, that shows the move.
4. **pile** — the pile id this describes.

Return exactly one group per pile — every pile id must appear exactly once. Judge only from the evidence shown; do not invent moves that are not in these piles.

${piles.map((p) => render(p, moments)).join('\n\n')}`;
}

/**
 * Name every pile in one call. Returns [] when the assistant is unavailable or the reply is
 * unusable — refuse, don't lie: a build with no names writes no profile, which is the honest outcome.
 */
export function namePiles(piles: Pile[], moments: Moment[]): Named[] {
  if (!piles.length) return [];
  const brain = pickBrain();
  if (!brain) return [];
  const answer = brain.ask(prompt(piles, moments), { role: 'main', feature: 'name', timeoutMs: TIMEOUT_MS, schema: SCHEMA });
  if (!answer) return [];
  const raw = answer.text;
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
 * The contract, enforced in code rather than hoped for: every pile named at most once, and only
 * piles that exist. A pile named TWICE would double-count its moments, inflating the very numbers
 * that are the profile's receipt — first claim wins. A pile named by NOBODY is dropped rather than
 * guessed at; its moments get an empty `kinds`, which is a real answer.
 */
function validate(groups: Named[], piles: Pile[]): Named[] {
  const known = new Set(piles.map((p) => p.id));
  const claimed = new Set<number>();
  const out: Named[] = [];
  for (const g of groups) {
    if (!g?.name || typeof g.pile !== 'number') continue;
    if (!known.has(g.pile) || claimed.has(g.pile)) continue;
    claimed.add(g.pile);
    out.push({
      name: String(g.name).trim(),
      description: String(g.description ?? '').trim(),
      quote: String(g.quote ?? '').trim(),
      pile: g.pile,
    });
  }
  return out;
}
