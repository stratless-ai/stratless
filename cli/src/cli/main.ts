/**
 * stratless — build your AI a model of who you are, so it stops making you feel stupid.
 *
 *   stratless mirror    a free read of you and your AI, from live logs — changes nothing, no setup
 *   stratless init      keep your history, see a free read, build your profile
 *   stratless profile   see the model of you — LOOKS, never spends; update LOADS
 *   stratless update    read what's new; rebuild + load the profile
 *   stratless stop      turn it off — stop refreshing and unload the profile
 *   stratless status    stratless's own state: on or off, and what it has cost
 *
 * Runs on your machine. Reads your own history. Nothing leaves.
 */
import { installedVersion } from '../storage/profile.js';
import { migrateLegacyInstall } from '../integrations/migrations.js';
import { runWorker } from '../runner/loop.js';
import { C, hint } from './ui.js';
import { argProblem, editDistance, validatesArgs } from './args.js';
import { mirror } from './commands/mirror.js';
import { init } from './commands/init.js';
import { profile } from './commands/profile.js';
import { update } from './commands/update.js';
import { stop } from './commands/stop.js';
import { status } from './commands/status.js';
import { serve } from '../integrations/mcp.js';

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  // The profile moved out of Claude Code's directory into ours; carry an older install across before
  // anything reads a path. Here rather than deeper because EVERY entry point reads it — the worker,
  // `profile`, `status`, and the MCP server all resolve it through `humanMdPath()`. Costs one
  // existsSync when there is nothing to do.
  // Move the artifact, then re-aim whatever pointed at it: an import addressed to a file that
  // no longer exists is a profile that silently stops loading.
  migrateLegacyInstall();

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

  // Muscle memory outlives a command. `report` folded into `profile`; `patterns` and `receipt` are
  // not part of the current surface (the discovery pipeline carries the evidence in the profile
  // itself). Redirect rather than error at someone who typed what used to work.
  if (cmd === 'report' || cmd === 'patterns' || cmd === 'receipt') {
    console.log(`\n  ${C.it(`${cmd} isn't part of stratless right now.`)}`);
    console.log(`  ${C.dim(`see the model of you with ${C.b(hint('stratless profile'))}`)}\n`);
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
    ${C.b('stratless init')}       ${C.dim('keep your history, see a free read, build your profile')}
    ${C.b('stratless profile')}    ${C.dim('see the model of you — free, instant, never spends')}
    ${C.b('stratless update')}     ${C.dim('read what is new; rebuild + load the profile')}
    ${C.b('stratless stop')}       ${C.dim('turn it off — stop refreshing and unload the profile')}
    ${C.b('stratless status')}     ${C.dim("stratless's own state and what it has cost (--check: newer version?)")}
    ${C.b('stratless mcp')}        ${C.dim('serve the profile to any MCP client — for their config, not for typing')}

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
  if (cmd === 'mcp') {
    // stdio IS the protocol here: no banner, no spinner, nothing on stdout but JSON-RPC frames.
    process.exitCode = await serve();
    return;
  }
  if (cmd === 'mirror') return await mirror(args.slice(1));
  if (cmd === 'status') return await status(args.slice(1));
  if (cmd === 'profile') return await profile();
  if (cmd === 'update') return await update(args.slice(1));
  if (cmd === 'stop') {
    process.exitCode = await stop();
    return;
  }

  // A mistyped COMMAND gets the same courtesy as a mistyped flag (0.3.5): name the nearest one,
  // never just reject. The user-facing verbs, in help order.
  const KNOWN = ['init', 'mirror', 'profile', 'update', 'stop', 'status', 'mcp', 'help'];
  const guess = cmd ? KNOWN.map((k) => [k, editDistance(cmd, k)] as const).filter(([, d]) => d <= 3).sort((a, b) => a[1] - b[1])[0]?.[0] : undefined;
  console.error(`\n  ${C.bad(`unknown command: ${cmd}`)}${guess ? C.dim(`  (did you mean ${guess}?)`) : ''}`);
  console.error(`  ${C.dim(`see \`${hint('stratless help')}\` for the full list`)}\n`);
  process.exit(1);
}
