/**
 * TUNE — the door (Solo V2, step 6). Reads the base map, derives the tune, inspects what's
 * already fitted, prints the full prescription — stage card, every artifact with its receipt
 * and status, exact paths — and takes ONE yes, default No. Only then do bytes land. Re-running
 * is the refresh: the same door diffs against disk and says new / updated / unchanged.
 *
 * v1 is deliberately the claude-code pair only: the Codex leg ships after its measured debts
 * (TUI approval, hot-reload, invocation drift) are observed against the live tool, per the
 * house rule that a leg is earned by measurement, never assumed from docs.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { embedAll, modelPresent, runtimePresent } from '../../pipeline/embedding/embed.js';
import { voicedPath } from '../../pipeline/voiced.js';
import { atomicWriteFileSync } from '../../storage/atomic.js';
import { compileTune } from '../../tune/compile.js';
import { deriveTune, stageOf } from '../../tune/derive.js';
import type { DerivedUnit } from '../../tune/derive.js';
import { planInstall, upsertTuneSection } from '../../tune/door.js';
import type { InstallPlan, PlanEntry } from '../../tune/door.js';
import { inspectTune, readInstalledSkills } from '../../tune/inspect.js';
import { assembleTuneInput } from '../../tune/rows.js';
import { C, hint, startSpinner } from '../ui.js';
import { confirmBuild } from './update.js';

const RECORD = 'claude-code';

const STAGE_LABEL: Record<string, string> = {
  'base-map': 'Base map',
  'stage-1': 'Stage 1',
  'stage-2': 'Stage 2',
  'stage-3': 'Stage 3',
};

/** One receipt clause per entry, and one ROW speaks for it: the patch's own home row where a
 *  patch seats the unit (its count with ITS slip — never one row's count beside another row's
 *  failure), else the strongest member. Numerals are code-stamped here and nowhere else in the
 *  door's own copy. */
function receiptOf(unit: DerivedUnit): string {
  const holder = unit.members.find((m) => m.patch && m.patch.state === 'open');
  if (holder?.patch) return `${holder.count}× · slip ${holder.patch.slip}×`;
  const top = [...unit.members].sort((a, b) => b.count - a.count)[0];
  return top ? `${top.count}×` : '';
}

function printEntry(e: PlanEntry, unit: DerivedUnit | undefined): void {
  const glyph = e.artifact.kind === 'ambient' ? '≈' : '⚙';
  const status =
    e.status === 'covered'
      ? C.dim(`kept yours — covered by ${e.coveredBy ?? 'an installed skill'}`)
      : e.status === 'unchanged'
        ? C.dim('unchanged')
        : C.ok(e.status);
  const receipt = unit ? C.dim(`(${receiptOf(unit)})`) : '';
  console.log(`    ${glyph} ${C.b(e.artifact.name)}  ${receipt}  ${status}`);
}

export async function tune(): Promise<number> {
  const home = homedir();
  if (!existsSync(voicedPath(RECORD))) {
    console.log(`\n  ${C.dim('no base map yet — the tune is derived from it.')}`);
    console.log(`  ${C.dim(`build one first: ${C.b(hint('stratless init'))}`)}\n`);
    return 1;
  }
  if (!runtimePresent() || !modelPresent()) {
    console.log(`\n  ${C.dim('the local engine is not installed — the tune derives with it.')}`);
    console.log(`  ${C.dim(`it arrives with your consent at ${C.b(hint('stratless init'))}`)}\n`);
    return 1;
  }

  const stopSpinner = startSpinner('deriving your tune from the base map…');
  const input = assembleTuneInput(RECORD);
  const derived = await deriveTune(input, embedAll);
  const installed = readInstalledSkills([join(home, '.claude', 'skills')]);
  const verdicts = await inspectTune(derived.units, installed, embedAll);
  const artifacts = compileTune(derived);
  stopSpinner();

  const stage = stageOf(derived);
  if (stage === 'base-map') {
    console.log(`\n  ${C.b('Base map only')} — ${C.dim('your record supports no real habit yet.')}`);
    console.log(`  ${C.dim('the tune arrives as your history grows; nothing to install today.')}\n`);
    return 0;
  }

  const target = {
    skillsDir: join(home, '.claude', 'skills'),
    blocksDir: join(home, '.stratless', 'tune', RECORD),
  };
  const existing = new Map<string, string>();
  for (const a of artifacts) {
    const root = a.kind === 'ambient' ? target.blocksDir : target.skillsDir;
    const p = `${root}/${a.filename}`;
    if (existsSync(p)) existing.set(p, readFileSync(p, 'utf8'));
  }
  const plan = planInstall(artifacts, verdicts, target, existing);
  const unitOf = new Map(derived.units.map((u) => [u.anchor, u]));

  console.log(`\n  ${C.b(`Your tune — ${RECORD} pair`)}`);
  console.log(`\n  ${C.b(`${STAGE_LABEL[stage]} · ${plan.counts.skills} skill${plan.counts.skills === 1 ? '' : 's'} + ${plan.counts.styles} style${plan.counts.styles === 1 ? '' : 's'}`)}\n`);
  const skills = plan.entries.filter((e) => e.artifact.kind !== 'ambient');
  const styles = plan.entries.filter((e) => e.artifact.kind === 'ambient');
  console.log(`  ${C.dim('SKILLS — habits at their moments')}`);
  for (const e of skills) printEntry(e, unitOf.get(e.artifact.name));
  console.log(`\n  ${C.dim('STYLE — always on')}`);
  for (const e of styles) printEntry(e, unitOf.get(e.artifact.name));
  if (derived.leftovers.length > 0) {
    console.log(`\n  ${C.dim(`${derived.leftovers.length} rows stay rows — the map carries them, the tune does not.`)}`);
  }
  console.log(`\n  ${C.dim(`writes to ${target.skillsDir.replace(home, '~')} and ${target.blocksDir.replace(home, '~')} · nothing else touched`)}`);
  console.log(`  ${C.dim(`every receipt is your own count · remove any time: ${C.b(hint('stratless stop'))}`)}`);

  if (plan.counts.newOrUpdated === 0) {
    console.log(`\n  ${C.ok('your installed tune is current')} ${C.dim('— nothing to write.')}\n`);
    return 0;
  }
  if (!process.stdin.isTTY) {
    console.log(`\n  ${C.dim('run in a terminal to install — the door takes a typed yes, never an implied one.')}\n`);
    return 0;
  }

  let yes: boolean;
  try {
    yes = await confirmBuild(`\n  Install? ${C.dim('[y/N]')} `);
  } catch {
    yes = false; // an aborted prompt is a no — never a crash, never a write
  }
  if (!yes) {
    console.log(`\n  ${C.dim('nothing written. the prescription stands whenever you want it.')}\n`);
    return 0;
  }

  for (const w of plan.writes) {
    mkdirSync(dirname(w.path), { recursive: true });
    atomicWriteFileSync(w.path, w.content);
  }
  // The always-loaded style block rides OUR OWN markers in CLAUDE.md — never the profile's.
  const claudeMd = process.env.STRATLESS_CLAUDE_MD || join(home, '.claude', 'CLAUDE.md');
  const doc = existsSync(claudeMd) ? readFileSync(claudeMd, 'utf8') : '';
  atomicWriteFileSync(claudeMd, upsertTuneSection(doc, plan.blockPaths, home));

  console.log(`\n  ${C.ok('tune installed.')} ${C.dim(`${plan.counts.newOrUpdated} file${plan.counts.newOrUpdated === 1 ? '' : 's'} written.`)}`);
  console.log(`  ${C.dim(`your assistant picks it up next session · refresh after an update: ${C.b(hint('stratless tune'))}`)}\n`);
  return 0;
}
