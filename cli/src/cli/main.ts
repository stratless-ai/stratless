/**
 * stratless — build your AI a model of who you are, so it stops making you feel stupid.
 *
 *   stratless mirror    a free read of you and your AI, from live logs — changes nothing, no setup
 *   stratless init      keep your history, see a free read, build your record's evidence
 *   stratless tune      the sitting: measure your record, hear the proposal, one yes installs
 *   stratless update    read what's new; keep the evidence current
 *   stratless stop      turn it off — stop refreshing and remove everything installed
 *   stratless status    stratless's own state: on or off, and what it has cost
 *
 * Runs on your machine. Reads your own history. Nothing leaves.
 */
import { installedVersion } from '../storage/profile.js';
import { runWorker } from '../runner/loop.js';
import { C, hint } from './ui.js';
import { argProblem, editDistance, validatesArgs } from './args.js';
import { mirror } from './commands/mirror.js';
import { init } from './commands/init.js';
import { update } from './commands/update.js';
import { stop } from './commands/stop.js';
import { tune } from './commands/tune.js';
import { status } from './commands/status.js';

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
    console.log(`stratless ${installedVersion()}`);
    return;
  }

  // Strict args before anything runs: a typo must never silently become a different request.
  if (cmd && validatesArgs(cmd)) {
    const problem = argProblem(cmd, args.slice(1));
    if (problem) {
      console.error(`\n  ${C.bad(problem)}`);
      console.error(`  ${C.dim(`see \`${hint('stratless help')}\` for what ${cmd} takes`)}\n`);
      process.exit(1);
    }
  }

  if (cmd === 'init') return await init();
  if (cmd === 'tune') {
    process.exitCode = await tune();
    return;
  }

  // Muscle memory outlives a command. `profile` and `mcp` retired when the profile became
  // internal evidence — the sitting reads it, nobody imports it. `report`/`patterns`/`receipt`
  // are older still. Redirect rather than error at someone who typed what used to work.
  if (cmd === 'profile' || cmd === 'mcp' || cmd === 'report' || cmd === 'patterns' || cmd === 'receipt') {
    console.log(`\n  ${C.it(`${cmd} isn't part of stratless anymore.`)}`);
    console.log(`  ${C.dim(`your record is internal evidence now — the sitting reads it: ${C.b(hint('stratless tune'))}`)}\n`);
    return;
  }

  // `stats` folded into `mirror` (0.4.4): the same read, but `stats` read a frozen archive snapshot
  // while `mirror` reads live. Point the muscle memory at the survivor rather than error.
  if (cmd === 'stats') {
    console.log(`\n  ${C.it('stats is now `mirror`.')}`);
    console.log(`  ${C.dim(`see your read with ${C.b(hint('stratless mirror'))}`)}\n`);
    return;
  }

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(`
  ${C.b('stratless')} — build your AI a model of who you are

    ${C.dim('get started:')}  ${C.b('npx stratless')} ${C.dim('(a free read)')}  ·  ${C.b('npx stratless init')} ${C.dim('(keep + build)')}

    ${C.b('stratless mirror')}     ${C.dim('a free read of you and your AI, changes nothing, no setup (--share: a card)')}
    ${C.b('stratless init')}       ${C.dim("keep your history, see a free read, build your record's evidence")}
    ${C.b('stratless tune')}       ${C.dim('the sitting: measure, hear the proposal with receipts, one yes installs')}
    ${C.b('stratless update')}     ${C.dim('read what is new; keep the evidence current')}
    ${C.b('stratless stop')}       ${C.dim('turn it off — stop refreshing and remove everything installed')}
    ${C.b('stratless status')}     ${C.dim("stratless's own state and what it has cost (--check: newer version?)")}

  ${C.dim('Runs on your machine. Reads your own history. Nothing leaves.')}
  ${C.dim('docs: https://stratless.com/docs')}
`);
    return;
  }

  // Bare `stratless` is the one-word CTA: show the free read, not the help wall. The explicit help
  // flags above still print the full list, so nothing is unreachable.
  if (!cmd) return mirror([]);

  if (cmd === '__worker') {
    // hidden: the doorbells spawn this — the worker process's whole life is runWorker()
    process.exitCode = await runWorker();
    return;
  }
  if (cmd === 'mirror') return await mirror(args.slice(1));
  if (cmd === 'status') return await status(args.slice(1));
  if (cmd === 'update') return await update(args.slice(1));
  if (cmd === 'stop') {
    process.exitCode = await stop();
    return;
  }

  // A mistyped COMMAND gets the same courtesy as a mistyped flag (0.3.5): name the nearest one,
  // never just reject. The user-facing verbs, in help order.
  const KNOWN = ['init', 'mirror', 'tune', 'update', 'stop', 'status', 'help'];
  const guess = cmd ? KNOWN.map((k) => [k, editDistance(cmd, k)] as const).filter(([, d]) => d <= 3).sort((a, b) => a[1] - b[1])[0]?.[0] : undefined;
  console.error(`\n  ${C.bad(`unknown command: ${cmd}`)}${guess ? C.dim(`  (did you mean ${guess}?)`) : ''}`);
  console.error(`  ${C.dim(`see \`${hint('stratless help')}\` for the full list`)}\n`);
  process.exit(1);
}
