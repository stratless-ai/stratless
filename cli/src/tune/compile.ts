/**
 * THE COMPILER — the sitting's brain and its gate, in one file.
 *
 * The guide (the pair's own model) reads the measured evidence and proposes skills; code disposes
 * of every claim it makes. Prose comes from the guide, receipts are code-stamped from the cited
 * findings, and every numeral lives in the Receipts section and nowhere else (the numerals
 * boundary, extended to the tune's output).
 *
 * This stage compiles to STRINGS. Writing files to disk is the door's job — the compiler stays
 * pure so the report can be shown, diffed, and refused without a byte landing anywhere.
 */
export interface CompiledArtifact {
  /** the artifact's tier — actives deliver as skills, ambients as always-loaded blocks */
  kind: 'active' | 'triggered' | 'ambient';
  name: string;
  /** where the artifact lands relative to its destination root (skills dir / tune dir) */
  filename: string;
  content: string;
}

/* THE GUIDE — bundle the findings, ask the pair's own model ONCE, dispose by code. The model
   writes; it never decides: a proposal citing no evidence dies, a quote that isn't verbatim
   dies, a digit in prose dies. Refuse-don't-lie: no brain, bad JSON, all proposals rejected →
   an empty sitting and an honest report, never an invented skill. */

import { brainFor } from '../integrations/brains/registry.js';
import type { Finding } from './derive.js';
import { assembleTuneInput } from './rows.js';

/** Base-map rows and open patches enter the sitting as evidence beside the findings. */
export interface EvidenceItem {
  id: string;
  kind: Finding['kind'] | 'row' | 'patch';
  claim: string;
  receipts: Record<string, number>;
  quotes: string[];
}

export function evidenceOf(findings: Finding[], record: string): EvidenceItem[] {
  const items: EvidenceItem[] = findings.map((f) => ({
    id: f.id,
    kind: f.kind,
    claim: f.claim,
    receipts: f.receipts,
    quotes: [
      ...f.exemplars.map((e) => e.quote ?? '').filter(Boolean),
      ...Object.values(f.detail ?? {}).flatMap((v) => (Array.isArray(v) ? v : [v])),
    ],
  }));
  const input = assembleTuneInput(record);
  for (const r of input.rows) {
    if (!r.line) continue;
    items.push({ id: `row:${record}:${r.name}`, kind: 'row', claim: r.line, receipts: { count: r.count }, quotes: [r.quote].filter(Boolean) });
    if (r.patch && r.patch.state === 'open')
      items.push({
        id: `patch:${record}:${r.name}`,
        kind: 'patch',
        claim: r.patch.when,
        receipts: { reach: r.patch.reach, slip: r.patch.slip },
        quotes: [r.patch.ownVoice, r.patch.doThis].filter(Boolean),
      });
  }
  return items;
}

export interface Proposal {
  name: string;
  kind: 'skill' | 'style';
  description: string;
  standard: string;
  moves: string[];
  citations: string[];
  quote?: string;
}

export type Disposed =
  | { proposal: Proposal; ok: true }
  | { proposal: Proposal; ok: false; reasons: string[] };

const PROPOSAL_SCHEMA = JSON.stringify({
  type: 'object',
  required: ['proposals'],
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'kind', 'description', 'standard', 'moves', 'citations'],
        properties: {
          name: { type: 'string' },
          kind: { enum: ['skill', 'style'] },
          description: { type: 'string' },
          standard: { type: 'string' },
          moves: { type: 'array', items: { type: 'string' } },
          citations: { type: 'array', items: { type: 'string' } },
          quote: { type: 'string' },
        },
      },
    },
  },
});

export const GUIDE_CAP = 5;

/** What the person already runs — name plus, where known, the description it competes on.
 *  The guide gets both, because a duplicate hides behind a fresh name. `minted` marks a previous
 *  tune of OURS: never a collision (a tune replacing itself is an update), so it is exempt from
 *  the duplicate gate and presented to the guide as refreshable instead. */
export interface InstalledNote {
  name: string;
  description?: string;
  minted?: boolean;
}

/** The guide's brief. Everything it may cite is in front of it; everything else is forbidden. */
export function guidePrompt(evidence: EvidenceItem[], installed: InstalledNote[]): string {
  const lines = evidence.map(
    (e) => `${e.id} [${e.kind}] ${e.claim}${e.quotes.length ? ` — their words: ${e.quotes.slice(0, 3).map((q) => `"${q}"`).join(' · ')}` : ''}`,
  );
  const theirs = installed.filter((s) => !s.minted);
  const ours = installed.filter((s) => s.minted);
  const installedLines = theirs.map((s) => `- ${s.name}${s.description ? ` — ${s.description}` : ''}`);
  const mintedLines = ours.map((s) => `- ${s.name}${s.description ? ` — ${s.description}` : ''}`);
  return [
    'You are the guide. You have watched one person work with their AI assistant, and the evidence below is everything you have seen — measured from their own history, each line with an ID.',
    '',
    'EVIDENCE (cite by ID; you may cite nothing else):',
    ...lines,
    '',
    ...(installedLines.length
      ? ['ALREADY INSTALLED (never duplicate — not by name, not by substance under a new name):', ...installedLines, '']
      : []),
    ...(mintedLines.length
      ? [
          'MINTED BY A PREVIOUS SITTING (ours — re-propose one ONLY if the evidence still supports it; it refreshes in place rather than duplicating):',
          ...mintedLines,
          '',
        ]
      : []),
    'Propose at most five skills that convert what this person demonstrably values into something they no longer carry. Rules, absolute:',
    '- every proposal cites at least one evidence ID; a proposal without evidence will be discarded by a machine, not a taste',
    '- kind "skill" fires at a moment and does or shapes something; kind "style" is always-on register',
    '- description: third person, what + when, the person\'s own phrases as trigger words',
    '- standard: one sentence; moves: two to five imperative lines the assistant executes',
    '- a quote, if you use one, must be VERBATIM from the evidence\'s "their words" — never composed',
    '- no numerals anywhere in your prose; the receipts are stamped by code, not by you',
    'Return JSON per the schema.',
  ].join('\n');
}

const normText = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Code disposes. Every check is arithmetic over the sitting's own inputs. */
export function dispose(proposals: Proposal[], evidence: EvidenceItem[], installedNotes: InstalledNote[]): Disposed[] {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const fanout = new Map<string, number>();
  // Only THEIR names collide — a previous tune of ours re-proposed is an update, not a duplicate.
  const installed = new Set(installedNotes.filter((s) => !s.minted).map((s) => s.name.toLowerCase()));
  const out: Disposed[] = [];
  for (const p of proposals) {
    const reasons: string[] = [];
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(p.name)) reasons.push('name is not kebab-case');
    if (installed.has(p.name.toLowerCase())) reasons.push('duplicates an installed skill');
    if (!p.citations?.length) reasons.push('cites no evidence');
    for (const c of p.citations ?? []) if (!byId.has(c)) reasons.push(`unknown evidence: ${c}`);
    const prose = [p.description, p.standard, ...(p.moves ?? []), p.quote ?? ''].join(' ');
    if (/[0-9]/.test(prose)) reasons.push('numerals in prose — receipts are code-stamped');
    if (!p.moves?.length || p.moves.length > 5) reasons.push('moves must be one to five lines');
    if (p.quote) {
      // Verbatim is one-directional: the quote appears INSIDE the person's recorded words.
      // The reverse containment would let a real fragment be wrapped in composed words.
      const q = normText(p.quote);
      const cited = (p.citations ?? []).map((c) => byId.get(c)).filter(Boolean) as EvidenceItem[];
      if (!q || !cited.some((e) => e.quotes.some((w) => normText(w).includes(q))))
        reasons.push('quote is not verbatim from cited evidence');
    }
    if (out.filter((d) => d.ok).length >= GUIDE_CAP) reasons.push('over the cap');
    if (reasons.length === 0) {
      // Fan-out commits only on acceptance — a rejected proposal must not consume a
      // finding's budget for the proposals that follow it.
      const over = (p.citations ?? []).filter((c) => (fanout.get(c) ?? 0) >= 2);
      if (over.length) reasons.push(...over.map((c) => `evidence ${c} already backs two accepted proposals`));
      else for (const c of p.citations) fanout.set(c, (fanout.get(c) ?? 0) + 1);
    }
    out.push(reasons.length ? { proposal: p, ok: false, reasons } : { proposal: p, ok: true });
  }
  return out;
}

/** An accepted proposal becomes a real artifact: prose from the guide, receipts from code. */
export function renderProposal(p: Proposal, evidence: EvidenceItem[], record: string): CompiledArtifact {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const cited = p.citations.map((c) => byId.get(c)!).filter(Boolean);
  const receiptLines = cited.map((e) => {
    const nums = Object.entries(e.receipts)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ');
    return `- ${e.id}: ${nums}`;
  });
  const body = [
    p.kind === 'skill' ? 'Fires at its moment.' : 'Always on.',
    '',
    p.standard,
    '',
    '## The moves',
    '',
    ...p.moves.map((m) => `- ${m}`),
    ...(p.quote ? ['', `In their own words: "${p.quote}"`] : []),
    '',
    '## Receipts (code-stamped, never authored)',
    '',
    ...receiptLines,
    '',
    'Remove any time: delete this file, or `stratless stop` removes the whole tune.',
    '',
  ].join('\n');
  // ONE OUTPUT: the skillpack. A style is an always-on skill, not a memory write — nothing the
  // sitting produces ever lands outside the skills directory (Sun, 2026-08-11).
  return {
    kind: 'active',
    name: p.name,
    filename: `${p.name}/SKILL.md`,
    content: `---\nname: ${p.name}\ndescription: ${p.description} Minted by stratless from this pair's own record — receipts inside.\n---\n\n# ${p.name}\n\n${body}`,
  };
}

export interface Sitting {
  evidence: EvidenceItem[];
  disposed: Disposed[];
  artifacts: CompiledArtifact[];
}

export type AskFn = (prompt: string, schema: string) => string | undefined;

/** The sitting: one call, everything else code. `ask` injectable for tests; production rides
 *  the pair's own brain, metered under feature 'consult'. */
export function consult(
  record: string,
  findings: Finding[],
  installed: InstalledNote[],
  ask?: AskFn,
): Sitting {
  const evidence = evidenceOf(findings, record);
  const doAsk: AskFn =
    ask ??
    ((prompt, schema) => brainFor(record)?.ask(prompt, { role: 'main', feature: 'consult', timeoutMs: 300_000, schema })?.text);
  const raw = doAsk(guidePrompt(evidence, installed), PROPOSAL_SCHEMA);
  let proposals: Proposal[] = [];
  if (raw) {
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) proposals = (JSON.parse(m[0]) as { proposals?: Proposal[] }).proposals ?? [];
    } catch {
      /* refuse-don't-lie: unparseable → empty sitting */
    }
  }
  const disposed = dispose(proposals, evidence, installed);
  const artifacts = disposed.filter((d) => d.ok).map((d) => renderProposal(d.proposal, evidence, record));
  return { evidence, disposed, artifacts };
}
