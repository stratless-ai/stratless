import { existsSync } from 'node:fs';
import { disarmEverywhere, unloadEverywhere } from '../../integrations/assistants/registry.js';
import { humanMdPath } from '../../storage/profile.js';
import { modelDir, runtimeDir } from '../../pipeline/embedding/config.js';
import { runtimeInstalled } from '../../pipeline/embedding/fetch.js';
import { lockFilePath, stopWorker } from '../../runner/worker.js';
import { pairFiles } from './profile.js';
import { C, hint } from '../ui.js';

/**
 * STOP — the off switch. Removes every after-session refresh hook and unloads the profile from every
 * assistant carrying it; the HUMAN.*.md files stay in place (the person's data). A running worker is
 * signalled only when its identity is proved. Otherwise the future refresh is off but the command
 * refuses to call the surviving process stopped — an honest partial stop is part of earning trust.
 */
export async function stop(): Promise<number> {
  // C7 first: a RUNNING worker dies before anything else — the off switch means the spending
  // halts now, not after the current build finishes.
  const worker = await stopWorker();
  const disarmed = disarmEverywhere();
  const hookRemoved = disarmed.length > 0;
  const unloadedFrom = unloadEverywhere();
  const unloaded = unloadedFrom.length > 0;
  const blocked = worker.status === 'foreground' || worker.status === 'unverified';
  if (worker.status === 'not-running' && !hookRemoved && !unloaded) {
    console.log(`\n  ${C.dim('nothing to stop — no running refresh, no refresh hook, no loaded profile.')}\n`);
    return 0;
  }
  console.log(
    blocked
      ? `\n  ${C.warn('stratless is not fully off — one process is still running.')}`
      : `\n  ${C.ok('stratless is off.')}`,
  );
  if (worker.status === 'stopped') {
    console.log(`  ${C.dim(`· background refresh stopped (pid ${worker.pid})`)}`);
    console.log(`  ${C.dim('  everything already judged is banked — restarting re-reads at most one chunk')}`);
  }
  if (worker.status === 'foreground') {
    console.log(`  ${C.warn(`· foreground stratless command still running (pid ${worker.pid})`)}`);
    console.log(`  ${C.dim('  it belongs to another terminal, so stratless refused to signal it')}`);
  }
  if (worker.status === 'unverified') {
    console.log(`  ${C.warn(`· background process still running (pid ${worker.pid})`)}`);
    console.log(`  ${C.dim('  its identity could not be verified, so stratless refused to signal it')}`);
    console.log(`  ${C.dim(`  lock: ${lockFilePath()}`)}`);
  }
  if (hookRemoved) console.log(`  ${C.dim('· after-session refresh removed')}`);
  for (const { warnings } of disarmed) {
    for (const warning of warnings) console.log(`  ${C.warn(`· ${warning}`)}`);
  }
  for (const a of unloadedFrom) console.log(`  ${C.dim(`· profile unloaded from ${a.displayName}`)}`);
  {
    // Name every file that stays — each pair's profile, and the merged-era one if it survives. All
    // of them are the person's data; the off switch removes deliveries, never evidence.
    const kept = [...pairFiles().filter((p) => p.exists).map((p) => p.path), ...(existsSync(humanMdPath()) ? [humanMdPath()] : [])];
    if (kept.length) console.log(`  ${C.dim(`Your ${kept.join(' and ')} ${kept.length === 1 ? 'is' : 'are'} left as-is — delete ${kept.length === 1 ? 'it' : 'them'} yourself if you want ${kept.length === 1 ? 'it' : 'them'} gone.`)}`);
  }
  if (existsSync(modelDir())) {
    console.log(`  ${C.dim(`The local model (~34MB) is still at ${modelDir()} — remove it if you want the disk back.`)}`);
  }
  if (runtimeInstalled()) {
    console.log(`  ${C.dim(`The local runtime (~11MB) is still at ${runtimeDir()} — remove it if you want the disk back.`)}`);
  }
  console.log(
    blocked
      ? `  ${C.dim(`Wait for pid ${worker.pid} to finish (or resolve it yourself), then run \`${hint('stratless stop')}\` again to confirm everything is off.`)}\n`
      : `  ${C.dim(`Run \`${hint('stratless update')}\` to load it again, \`${hint('stratless init')}\` to turn the refresh back on.`)}\n`,
  );
  return blocked ? 1 : 0;
}
