/**
 * THE COMPILER — derived units become installable artifacts (Solo V2, step 4).
 *
 * Model-free by construction. Every sentence in a compiled artifact is voiced-once content the
 * record already paid for — fold lines, row lines, patch wording, decode signals and quotes —
 * assembled by template; every numeral is code-stamped into the Receipts section and nowhere
 * else (the numerals boundary, extended to the tune's output). Same derivation in, same bytes
 * out: the wobble class cannot exist here because nothing here rolls.
 *
 * This stage compiles to STRINGS. Writing files to disk is the door's job (step 6) — the
 * compiler must stay pure so the prescription can be shown, diffed, and refused without a
 * byte landing anywhere.
 *
 * Artifact shapes (the hand-mint's blessed form, builds/paper-mint/):
 *   SKILL — frontmatter (name + trigger-vocabulary description) · the standard · the moves ·
 *           the patched standard where one seats it · receipts · sunset.
 *   BLOCK — no frontmatter (not a skill; always-loaded via the load path): a header comment
 *           says what it is, then the same body shape.
 */
import type { DerivedTune, DerivedUnit } from './derive.js';
import type { RowRecord } from './rows.js';

export interface CompiledArtifact {
  /** the unit's tier — actives and triggered styles deliver as skills, ambients as blocks */
  kind: 'active' | 'triggered' | 'ambient';
  name: string;
  /** where the artifact lands relative to its destination root (skills dir / tune dir) */
  filename: string;
  content: string;
}

/** The honest label every artifact prints about itself — the practicality claim, stated. */
const TIER_LINE: Record<CompiledArtifact['kind'], string> = {
  active: 'Active skill — performs work at its moment.',
  triggered: 'Triggered style — shapes the reply when its moment occurs.',
  ambient: 'Ambient style — always on; shapes every reply.',
};

const MAX_DESCRIPTION = 1024;

/** The seat's standard: the fold's printed line, or the patch's own when-clause turned whole. */
const standardOf = (u: DerivedUnit): string => {
  if (u.seat.group) return u.seat.group.line;
  const p = u.members.find((m) => m.name === u.seat.patchHome)?.patch;
  return p ? `${p.when}.` : u.members[0]!.line;
};

/** Trigger vocabulary, straight from the decode key: wants and proof phrases, deduped. */
const vocabulary = (members: RowRecord[]): { wants: string[]; quotes: string[] } => {
  const wants = [...new Set(members.map((m) => m.signal).filter(Boolean))];
  const quotes = [...new Set(members.map((m) => m.quote).filter(Boolean))];
  return { wants, quotes };
};

/** The description is the discovery mechanism (the 2026 docs' one law): what + when, third
 *  person, the person's own phrases as the keywords, capped hard at the format's limit.
 *  Exported because inspection compares on exactly this surface — the text skills compete on. */
export const describe = (u: DerivedUnit): string => {
  const { wants, quotes } = vocabulary(u.members);
  const parts = [standardOf(u)];
  if (wants.length) parts.push(`Use when the user ${wants.join('; or ')}.`);
  if (quotes.length) parts.push(`Their own phrases: ${quotes.map((q) => `"${q}"`).join(' · ')}.`);
  parts.push('Minted by stratless from this pair’s own record — receipts inside.');
  let out = parts.join(' ');
  if (out.length > MAX_DESCRIPTION) out = `${out.slice(0, MAX_DESCRIPTION - 1).replace(/\s+\S*$/, '')}…`;
  return out;
};

const receiptLine = (m: RowRecord, facet?: string): string => {
  const bits = [`${m.count}×`];
  if (facet) bits.push(facet);
  if (m.patch) bits.push(`slip ${m.patch.slip}× (reach ${m.patch.reach}×)`);
  return `- ${m.name}: ${bits.join(' · ')}`;
};

const receipts = (u: DerivedUnit): string => {
  const facets = new Map<string, string>();
  if (u.seat.group) u.seat.group.members.forEach((m, i) => facets.set(m.name, u.seat.group!.facets[i] ?? ''));
  return u.members.map((m) => receiptLine(m, facets.get(m.name))).join('\n');
};

const moves = (u: DerivedUnit): string =>
  u.members
    .filter((m) => m.line)
    .map((m) => `- ${m.line}`)
    .join('\n');

const patched = (u: DerivedUnit): string => {
  const holder = u.members.find((m) => m.patch && m.patch.state === 'open');
  if (!holder?.patch) return '';
  const p = holder.patch;
  const lines = [`## The patched standard`, '', `When: ${p.when}.`];
  if (p.doThis) lines.push(`The move: ${p.doThis}.`);
  if (p.ownVoice) lines.push(`In their own words: "${p.ownVoice}"`);
  if (p.action) lines.push(`Drive the native machinery — ${p.action} — never rebuild it.`);
  return `${lines.join('\n')}\n\n`;
};

const sunset = (u: DerivedUnit): string =>
  u.seat.patchHome
    ? 'This skill retires when its patch heals — the standard absorbed, the row alone sufficing.'
    : `This ${u.kind === 'ambient' ? 'style' : u.kind === 'triggered' ? 'style' : 'skill'} retires when its rows stop accruing across builds — the standard arriving unprompted.`;

const body = (u: DerivedUnit): string =>
  [
    TIER_LINE[u.kind],
    '',
    standardOf(u),
    '',
    '## The moves (voiced from this pair’s record)',
    '',
    moves(u),
    '',
    patched(u) + '## Receipts (code-stamped, never authored)',
    '',
    receipts(u),
    '',
    '## Sunset',
    '',
    `${sunset(u)} Check after each \`stratless update\`. Remove: delete this ${u.kind === 'ambient' ? 'file from the load path' : 'directory'}.`,
    '',
  ].join('\n');

const compileSkillFile = (u: DerivedUnit): CompiledArtifact => ({
  kind: u.kind,
  name: u.anchor,
  filename: `${u.anchor}/SKILL.md`,
  content: `---\nname: ${u.anchor}\ndescription: ${describe(u)}\n---\n\n# ${u.anchor}\n\n${body(u)}`,
});

const compileBlockFile = (u: DerivedUnit): CompiledArtifact => {
  // An ambient block has no frontmatter (nothing triggers it), so the person's proof phrases
  // surface in the body instead — register texture is where their own words teach the most.
  const { quotes } = vocabulary(u.members);
  const phrases = quotes.length ? `Their own phrases: ${quotes.map((q) => `"${q}"`).join(' · ')}.\n\n` : '';
  return {
    kind: u.kind,
    name: u.anchor,
    filename: `${u.anchor}.md`,
    content: `<!-- ALWAYS-LOADED BLOCK — not a skill. Continuous properties of every reply,\n     delivered through the load path. Minted by stratless; receipts inside. -->\n\n# ${u.anchor}\n\n${phrases}${body(u)}`,
  };
};

/** Compile every derived unit to its artifact. Pure; deterministic; no disk, no model.
 *  Actives and triggered styles deliver as SKILL.md (the trigger is the token economy either
 *  way); ambient styles deliver as always-loaded block files. */
export function compileTune(tune: DerivedTune): CompiledArtifact[] {
  return tune.units.map((u) => (u.kind === 'ambient' ? compileBlockFile(u) : compileSkillFile(u)));
}
