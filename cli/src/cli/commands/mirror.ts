import { loadAssignments } from '../../pipeline/assign.js';
import { join as joinLabelled, misfitRate } from '../../pipeline/count.js';
import { detect as detectAdapters } from '../../integrations/assistants/registry.js';
import { loadMoments } from '../../pipeline/moments.js';
import { mirrorOfArchive, mirrorOfEverything } from '../../mirror/mirror.js';
import { renderMirror, renderCard } from '../../mirror/view.js';
import { C, hint, startSpinner } from '../ui.js';

/**
 * MIRROR — the zero-commitment free read. A stranger runs `stratless mirror` (or bare `stratless`) and
 * sees how they and their AI work, computed from the LIVE logs of every assistant on the machine —
 * with NO `init`, no archive, no settings touched, no spend. Pure arithmetic → stdout. This is the
 * run-it-now, change-nothing surface the launch forwards; `--share` renders the screenshot-safe card
 * (aggregate-only, no repo or session names). The mirror is the diagnosis; `init`/`update` is the cure,
 * pointed at in the footer — never auto-run, because the whole promise is that this changed nothing.
 *
 * This is the ONE read now: `stats` (0.4.4) folded in here, since it printed the same rows off a
 * frozen archive snapshot while this reads live. Once a build exists it adds the `profile captures X%`
 * coverage line (what `stats` uniquely had) and the footer shifts from "build it" to "refresh it".
 */
export async function mirror(args: string[]): Promise<void> {
  const share = args.includes('--share');
  // Name the assistants this person actually has. Telling a Codex-only user to "talk to Claude Code
  // a few times" both fails and advertises a product they may never have installed — and this is
  // the headline surface, the one bare `stratless` runs.
  const empty = (): void => {
    const here = detectAdapters();
    const who = here.length ? here.map((a) => a.displayName).join(' or ') : 'your AI coding assistant';
    console.log(
      `\n  ${C.dim(`No conversations to read yet. Talk to ${who} a few times, then run`)} ${C.b(hint('stratless mirror'))} ${C.dim('again.')}\n`,
    );
  };

  // The LIVE logs of EVERY assistant on this machine, not the archive — this must work with nothing
  // archived and no init ever run.
  if (!detectAdapters().length) return empty();

  // The nested-tree walk is the ~10s wait; the async twin lets the spinner rotate through it.
  const stopReading = startSpinner('reading your history…', process.stdout);
  let m: ReturnType<typeof mirrorOfArchive> | undefined;
  try {
    m = await mirrorOfEverything();
  } catch {
    m = undefined;
  } finally {
    stopReading();
  }
  const rows = m ? (share ? renderCard(m) : renderMirror(m, { full: true })) : [];
  if (!rows.length) return empty();

  // Completeness: the share of your moments the built profile's categories cover (1 - the misfit
  // rate), shown in the positive frame. This is the one thing the retired `stats` had that the door
  // did not; it only means something once a build exists, so it is skipped before the first build and
  // never printed on the shareable card (a stranger has no profile, and it would leak nothing useful).
  let completeness: string | undefined;
  if (!share) {
    try {
      // Coverage is summed over each record's OWN join — every row is a within-pair match, so no
      // moment is ever measured against another assistant's categories.
      const moments = loadMoments();
      const labelled = detectAdapters().flatMap((a) =>
        joinLabelled(moments.filter((m) => m.record === a.record.id), loadAssignments(a.record.id)),
      );
      if (labelled.length) completeness = `${Math.round(100 * (1 - misfitRate(labelled)))}% of your moments`;
    } catch {
      /* no build yet — no completeness line */
    }
  }

  console.log(`\n  ${C.b(share ? 'You and your AI' : 'You and your AI, measured')}\n`);
  const w = Math.max(...rows.map((r) => r.label.length), completeness ? 'profile captures'.length : 0);
  for (const row of rows) console.log(`    ${C.dim(row.label.padEnd(w))}   ${C.b(row.value)}`);
  if (completeness) console.log(`    ${C.dim('profile captures'.padEnd(w))}   ${C.b(completeness)}`);

  if (share) {
    // A screenshot carries no funnel — just the neutral repro line, so a viewer can get their own.
    console.log(`\n  ${C.dim('npx stratless mirror · runs on your machine, nothing leaves')}\n`);
  } else if (completeness) {
    // A profile is already built — no build funnel; point at refresh and the rest of the surface.
    console.log(`\n  ${C.dim('Nothing was changed on your machine.')} ${C.dim('Refresh anytime:')} ${C.b(hint('stratless update'))}`);
    console.log(`  ${C.dim('all commands:')} ${C.b(hint('stratless help'))}\n`);
  } else {
    // No profile yet — the funnel to the full build.
    console.log(`\n  ${C.dim('Nothing was changed on your machine.')} ${C.dim('Keep it fresh + build the full profile:')} ${C.b(hint('stratless init'))}`);
    console.log(`  ${C.dim('all commands:')} ${C.b(hint('stratless help'))}\n`);
  }
}

