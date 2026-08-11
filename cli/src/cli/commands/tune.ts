/**
 * TUNE — the sitting. MEASURE · REPORT · INSTALL, one door, ONE SITTING PER PAIR.
 *
 * Every detected assistant gets its own sitting, in sequence, and nothing crosses the seam:
 * each pair's evidence is measured from its own record, consulted by its own brain on its own
 * plan, reported on its own page, and installed through its own tool's skill door (the
 * adapter's pack leg). Declining one pair's spend never aborts another's sitting; a pair with
 * too little history is told so honestly and costs nothing.
 *
 * Measure is free and local. The one paid moment per pair is the consultation — quoted and
 * consented before it runs. Everything the model claims is disposed by code (citations,
 * verbatim quotes, the numerals boundary), the report shows every acceptance AND every
 * rejection with its reason, and only one typed yes lands bytes. Re-running is the refresh:
 * the same door diffs against disk.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { brainFor } from '../../integrations/brains/registry.js';
import { detect } from '../../integrations/assistants/registry.js';
import type { Adapter } from '../../integrations/contracts.js';
import { embedAll, modelPresent, runtimePresent } from '../../pipeline/embedding/embed.js';
import { voicedPath } from '../../pipeline/voiced.js';
import { atomicWriteFileSync } from '../../storage/atomic.js';
import { consult } from '../../tune/compile.js';
import type { EvidenceItem, Proposal } from '../../tune/compile.js';
import { measure } from '../../tune/derive.js';
import { planInstall, upsertTuneSection } from '../../tune/door.js';
import type { PlanEntry } from '../../tune/door.js';
import { inspectDescriptions, readInstalledBlocks, readInstalledSkills } from '../../tune/inspect.js';
import { C, hint, startSpinner } from '../ui.js';
import { confirmBuild } from './update.js';

/** What one sitting costs on the person's own plan — measured on the reference machine
 *  (2026-08-10, usage ledger, feature `consult`), stated before it is spent. */
const SITTING_COST_USD = 0.08;

/** The receipt clause the report prints beside a skill: the strongest cited finding's own
 *  numbers. Numerals are code-stamped here and nowhere else in the door's copy. */
function receiptOf(p: Proposal, byId: Map<string, EvidenceItem>): string {
  const cited = p.citations.map((c) => byId.get(c)).filter((e): e is EvidenceItem => Boolean(e));
  const strongest = [...cited].sort(
    (a, b) => Math.max(...Object.values(b.receipts)) - Math.max(...Object.values(a.receipts)),
  )[0];
  if (!strongest) return '';
  return Object.entries(strongest.receipts)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ');
}

function printEntry(e: PlanEntry, p: Proposal | undefined, byId: Map<string, EvidenceItem>): void {
  const glyph = e.artifact.kind === 'ambient' ? '≈' : '⚙';
  const status =
    e.status === 'covered'
      ? C.dim(`kept yours — covered by ${e.coveredBy ?? 'an installed skill'}`)
      : e.status === 'unchanged'
        ? C.dim('unchanged')
        : C.ok(e.status);
  const receipt = p ? C.dim(`(${receiptOf(p, byId)})`) : '';
  console.log(`    ${glyph} ${C.b(e.artifact.name)}  ${receipt}  ${status}`);
  if (p) console.log(`      ${C.dim(p.standard)}`);
  if (p?.quote) console.log(`      ${C.dim(`in your own words: "${p.quote}"`)}`);
}

/** One pair's sitting, start to finish. Skips are honest lines, never silent; a skip or a
 *  declined quote costs nothing and lets the next pair sit. */
async function sitOne(a: Adapter, home: string): Promise<void> {
  const record = a.record.id;
  if (!existsSync(voicedPath(record))) {
    console.log(`  ${C.dim(`no evidence built for this pair yet — it arrives with ${C.b(hint('stratless update'))}.`)}\n`);
    return;
  }
  const brain = brainFor(record);
  if (!brain) {
    console.log(`  ${C.dim('no assistant to consult for this pair — the sitting asks its own model, and none is installed.')}\n`);
    return;
  }

  // MEASURE — free, local, printed as fact before anything is asked or spent.
  const stopMeasure = startSpinner('measuring the record…');
  const findings = await measure(record);
  stopMeasure();
  if (findings.length === 0) {
    console.log(`  ${C.dim('too little history to measure yet — the sitting needs evidence, not guesses. Keep working in it.')}\n`);
    return;
  }
  const byKind = new Map<string, number>();
  for (const f of findings) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
  const measuredLine = [...byKind.entries()].map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`).join(' · ');
  console.log(`  ${C.b('Measured from this record:')} ${measuredLine}`);

  // The spend, quoted before it happens. One call; a no costs nothing and the next pair still sits.
  let go: boolean;
  try {
    go = await confirmBuild(
      `\n  The sitting asks your own ${brain.displayName} once — about $${SITTING_COST_USD.toFixed(2)} of your plan. Proceed? ${C.dim('[y/N]')} `,
    );
  } catch {
    go = false;
  }
  if (!go) {
    console.log(`\n  ${C.dim('nothing asked, nothing spent for this pair.')}\n`);
    return;
  }

  // The installed world — this pair's own skill door, plus the legacy always-loaded blocks
  // (claude-code only; older installs) so a style they already carry is never re-proposed.
  const skillsDir = a.skillsDir();
  const blocksDir = join(home, '.stratless', 'tune', record);
  const installed = [
    ...readInstalledSkills([skillsDir]),
    ...(record === 'claude-code' ? readInstalledBlocks([join(home, '.stratless', 'tune'), blocksDir]) : []),
  ];

  const stopSitting = startSpinner(`consulting your ${brain.displayName}…`);
  const sitting = consult(
    record,
    findings,
    installed.map((s) => ({ name: s.name, description: s.description, minted: s.minted })),
  );
  stopSitting();

  const accepted = sitting.disposed.filter((d) => d.ok).map((d) => d.proposal);
  const rejected = sitting.disposed.filter((d) => !d.ok);
  if (accepted.length === 0) {
    console.log(`\n  ${C.dim('the sitting proposed nothing that survived the evidence gate — an honest empty page.')}`);
    for (const r of rejected) console.log(`    ${C.dim(`✕ ${r.proposal.name} — ${r.ok ? '' : r.reasons.join('; ')}`)}`);
    console.log('');
    return;
  }

  // The cover check runs on the description surface — a duplicate hides behind a fresh name.
  const verdicts = await inspectDescriptions(
    accepted.map((p) => ({ name: p.name, description: p.description })),
    installed,
    embedAll,
  );

  const target = { skillsDir, blocksDir };
  const existing = new Map<string, string>();
  for (const art of sitting.artifacts) {
    const p = `${skillsDir}/${art.filename}`;
    if (existsSync(p)) existing.set(p, readFileSync(p, 'utf8'));
  }
  const plan = planInstall(sitting.artifacts, verdicts, target, existing);
  const proposalOf = new Map(accepted.map((p) => [p.name, p]));
  const evidenceById = new Map(sitting.evidence.map((e) => [e.id, e]));

  // REPORT — everything the sitting concluded, acceptances and rejections alike.
  console.log(`\n  ${C.b(`${plan.counts.skills} skill${plan.counts.skills === 1 ? '' : 's'} proposed from the evidence`)}\n`);
  console.log(`  ${C.dim('THE PACK — every entry is a skill file; styles are always-on skills')}`);
  for (const e of plan.entries) printEntry(e, proposalOf.get(e.artifact.name), evidenceById);
  for (const r of rejected) {
    console.log(`    ${C.dim(`✕ ${r.proposal.name} — rejected: ${r.ok ? '' : r.reasons.join('; ')}`)}`);
  }
  console.log(`\n  ${C.dim(`writes to ${skillsDir.replace(home, '~')} · nothing else touched`)}`);
  console.log(`  ${C.dim(`every receipt is your own count · remove any time: ${C.b(hint('stratless stop'))}`)}`);

  if (plan.counts.newOrUpdated === 0) {
    console.log(`\n  ${C.ok('this pair’s installed tune is current')} ${C.dim('— nothing to write.')}\n`);
    return;
  }

  let yes: boolean;
  try {
    yes = await confirmBuild(`\n  Install? ${C.dim('[y/N]')} `);
  } catch {
    yes = false; // an aborted prompt is a no — never a crash, never a write
  }
  if (!yes) {
    console.log(`\n  ${C.dim('nothing written. the report stands whenever you want it.')}\n`);
    return;
  }

  for (const w of plan.writes) {
    mkdirSync(dirname(w.path), { recursive: true });
    atomicWriteFileSync(w.path, w.content);
  }
  // The pack never writes CLAUDE.md. The only touch left is the off-ramp: if an older install's
  // tune section is still in there, remove it — and never create the file to do so.
  if (record === 'claude-code') {
    const claudeMd = process.env.STRATLESS_CLAUDE_MD || join(home, '.claude', 'CLAUDE.md');
    if (existsSync(claudeMd)) {
      const doc = readFileSync(claudeMd, 'utf8');
      const next = upsertTuneSection(doc, [], home);
      if (next !== doc) atomicWriteFileSync(claudeMd, next);
    }
  }

  console.log(`\n  ${C.ok('tune installed.')} ${C.dim(`${plan.counts.newOrUpdated} file${plan.counts.newOrUpdated === 1 ? '' : 's'} written.`)}`);
  console.log(`  ${C.dim(`${a.displayName} picks it up next session · refresh after an update: ${C.b(hint('stratless tune'))}`)}\n`);
}

export async function tune(): Promise<number> {
  const home = homedir();
  if (!runtimePresent() || !modelPresent()) {
    console.log(`\n  ${C.dim('the local engine is not installed — the sitting inspects with it.')}`);
    console.log(`  ${C.dim(`it arrives with your consent at ${C.b(hint('stratless init'))}`)}\n`);
    return 1;
  }
  if (!process.stdin.isTTY) {
    console.log(`\n  ${C.dim('run in a terminal — the sitting spends on a typed yes, never an implied one.')}\n`);
    return 0;
  }
  const pairs = detect();
  if (!pairs.length) {
    console.log(`\n  ${C.dim('no assistant history found on this machine — nothing to measure yet.')}\n`);
    return 1;
  }

  // ONE SITTING PER PAIR. Each pair's page stands alone and is headed by the pair's name, so
  // no page can be read as speaking for another relationship.
  for (const a of pairs) {
    console.log(`\n  ${C.b(`Your tune — ${a.displayName} pair`)}\n`);
    await sitOne(a, home);
  }
  return 0;
}
