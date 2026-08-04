import { onPath } from '../../platform/executable.js';
import { brains, pickBrain } from '../../integrations/brains/registry.js';
import type { Adapter, ArmState, ProtectResult } from '../../integrations/contracts.js';
import { detect as detectAdapters, registry } from '../../integrations/assistants/registry.js';
import { archiveRoot } from '../../storage/paths.js';
import { ensureRuntime, modelPresent, runtimeInstalled, runtimePresent } from '../../pipeline/embedding/embed.js';
import { mirrorOfArchive, mirrorOfEverything } from '../../mirror/mirror.js';
import { renderMirror } from '../../mirror/view.js';
import { estimateBuild, estimateFromMessages, estimateLine } from '../../pipeline/estimate.js';
import { loadMoments } from '../../pipeline/moments.js';
import { armedLine, confirmBuild, update } from './update.js';
import { C, hint, startSpinner } from '../ui.js';

export async function init(): Promise<void> {
    // THE DOOR — the product's only interactive moment. Keep the history, show a FREE read of the
    // person (no spend), quote the paid build honestly, then take ONE consent: build now (watched) or
    // later. The paid build never fires without an explicit yes on a real terminal.
    // ONE LOOP OVER THE ASSISTANTS ACTUALLY ON THIS MACHINE. Every one expires and notifies
    // differently, so each keeps its own history and arms its own trigger — and one that is NOT here
    // is never written to. Creating a config directory for an assistant somebody does not use is
    // stratless leaving litter in a home folder to advertise itself.
    const here = detectAdapters();
    if (!here.length) {
      console.log(`\n  ${C.warn('stratless found no assistant to read on this machine.')}`);
      console.log(`  ${C.dim(`It reads ${registry.map((a) => a.displayName).join(' and ')} — nothing was created or changed.`)}\n`);
      return;
    }

    const kept: { adapter: Adapter; protect?: ProtectResult; arm: ArmState }[] = [];
    try {
      // Keep the history FIRST, then arm: a trigger that fired before the rescue would rebuild from
      // a vault that is not there yet.
      for (const a of here) kept.push({ adapter: a, protect: a.rhythm.protect?.(), arm: a.rhythm.arm() });
    } catch (err) {
      // Refuse, don't clobber — say what's wrong (a malformed settings.json or hooks.json) and stop.
      console.error(`\n  ${C.bad('stratless could not update your settings.')}`);
      console.error(`  ${C.dim(String(err instanceof Error ? err.message : err).split('\n').join('\n  '))}\n`);
      process.exit(1);
    }

    // 1. what we kept. Install = alive: the after-session refresh is on now; `stop` is the one ceremony.
    console.log(`\n  ${C.ok('stratless is keeping your history.')}\n`);
    const solo = kept.length === 1;
    for (const k of kept) {
      // With ONE assistant the rows stay flat — the overwhelming case, and an upgrade must not
      // reformat somebody's install on account of a tool they do not have. With two, group by name.
      const pad = solo ? '    ' : '      ';
      if (!solo) console.log(`    ${C.b(k.adapter.displayName)}`);
      if (k.protect?.reaper) console.log(`${pad}reaper           ${C.dim(k.protect.reaper.before)} → ${C.b(k.protect.reaper.after)}`);
      if (k.protect) {
        console.log(`${pad}archived         ${C.b(String(k.protect.copied))} transcripts${k.protect.skipped ? C.dim(` (${k.protect.skipped} already current)`) : ''}`);
      }
      if (solo) console.log(`${pad}kept at          ${C.dim(archiveRoot())}`);
      console.log(`${pad}after-session    ${armedLine(k.adapter, k.arm)}`);
    }
    if (!solo) console.log(`    kept at          ${C.dim(archiveRoot())}`);
    // The reaper paragraph belongs to the tool that HAS one. Codex never deletes its rollouts, so
    // printing this for it would invent a danger and then take credit for saving them from it.
    for (const k of kept) {
      if (!k.protect?.reaper) continue;
      console.log(`\n  ${C.dim(`${k.adapter.displayName} deletes transcripts after 30 days — per file, even in a project you`)}`);
      console.log(`  ${C.dim('use daily. Anything already gone is gone. Everything from here is kept.')}\n`);
    }

    // The armed hook runs the bare `stratless`; from an npx-only install it would silently do nothing.
    if (!onPath('stratless')) {
      console.log(`  ${C.warn('heads up:')} ${C.dim('the after-session refresh runs `stratless`, but it is not on your PATH yet.')}`);
      console.log(`  ${C.dim('Install it so the refresh can run:')} ${C.b('npm install -g stratless')}\n`);
    }

    // 2. the free read — computed from the archive we just froze. No model call, no spend. The
    //    archive walk takes ~10s on a big history, so spin a cursor through it (the async twin yields).
    const stopReading = startSpinner('reading your history…', process.stdout);
    let mirror: ReturnType<typeof mirrorOfArchive> | undefined;
    try {
      mirror = await mirrorOfEverything();
    } catch {
      mirror = undefined;
    } finally {
      stopReading();
    }
    const rows = mirror ? renderMirror(mirror) : [];
    if (!rows.length) {
      const here = detectAdapters();
      const who = here.length ? here.map((a) => a.displayName).join(' or ') : 'your AI coding assistant';
      console.log(`  ${C.dim(`No conversations to read yet — talk to ${who} a few times, then run`)} ${C.b(hint('stratless update'))}${C.dim('.')}\n`);
      return;
    }
    console.log(`  ${C.b('What I can already see')} ${C.dim('(free, from your own history):')}\n`);
    const w = Math.max(...rows.map((row) => row.label.length));
    for (const row of rows) console.log(`    ${C.dim(row.label.padEnd(w))}   ${C.b(row.value)}`);

    // 3. the estimate — the cold quote from the shipped rate card (estimate.ts); the live ETA takes
    //    over once the real build runs. Use the real pile if it exists; before it does, scale the
    //    mirror's message count UP to estimated moments so the quote never lands under the real spend.
    let pile = 0;
    try {
      pile = loadMoments().length;
    } catch {
      /* fresh machine: no pile yet */
    }
    const est = pile > 0 ? estimateBuild(pile) : estimateFromMessages(mirror!.scale.messages);
    console.log(`\n  ${C.dim('Full profile:')}    ${C.b(estimateLine(est))}   ${C.dim(`built on your own ${brains.filter((b) => b.detect()).length > 1 ? 'assistants' : (pickBrain()?.displayName ?? 'assistant')}, nothing leaves.`)}`);
    // THE STANDING PART OF THE ASK. Young history outgrows its first map; saying yes here also
    // covers those few later rebuilds — said out loud now, so they can announce instead of knock.
    console.log(`  ${C.dim('While it grows:')}  ${C.dim(`a young history outgrows its first map — stratless rebuilds it a few times as you go, cents each, announced in ${hint('stratless status')}.`)}`);
    // THE DOWNLOAD IS PART OF THE ASK. Most of the build now runs on a small local model, which is
    // why it costs cents instead of dollars — but the engine (~3MB runtime) and its weights (~34MB)
    // have to arrive once, and neither is in the npm package. Consenting to a build must mean
    // consenting to that, said out loud and itemized, before the yes. Silently pulling ~40MB
    // because someone agreed to a price is the kind of surprise the whole door exists to prevent.
    if (!runtimePresent()) {
      const arriving = [
        !runtimeInstalled() ? 'local runtime (~3MB)' : '',
        !modelPresent() ? 'local model (~34MB)' : '',
      ].filter(Boolean).join(' + ');
      console.log(`  ${C.dim('One-time:')}         ${C.b(arriving)}   ${C.dim('downloaded once, then every build runs offline.')}`);
    }

    // 4. the one consent. Only a real terminal can say yes; a pipe or a missing assistant points to
    //    `update`, which is itself the consented build path.
    const brain = pickBrain();
    if (brain && process.stdin.isTTY && process.stdout.isTTY) {
      console.log('');
      let yes = false;
      try {
        yes = await confirmBuild(`  Build your profile now? ${C.dim('[y/N]')} `);
      } catch {
        yes = false; // an aborted prompt (Ctrl-D/EOF) is a no — never a crash, never a build
      }
      if (yes) {
        // FOREGROUND, on the consented path only. The background Stop hook must never do this: a
        // ~40MB fetch that happens invisibly while someone is working is exactly the surprise the
        // door exists to prevent. If it fails, say so and stop — the build would only fail later.
        if (!runtimePresent()) {
          const stopFetch = startSpinner('fetching the local runtime (one time)…', process.stdout);
          try {
            await ensureRuntime();
          } catch (err) {
            stopFetch();
            console.error(`\n  ${C.bad('could not download the local runtime.')}`);
            console.error(`  ${C.dim(String(err instanceof Error ? err.message : err))}`);
            console.error(`  ${C.dim(`check your connection and run ${hint('stratless init')} again.`)}\n`);
            process.exit(1);
          }
          stopFetch();
        }
        return await update([], { consented: true }); // consent is explicit here — force the build
      }
    }
    console.log(`\n  ${C.dim('No rush — the free read stays and stratless keeps it current after each session.')}`);
    console.log(`  ${C.dim('Build the full profile any time with')} ${C.b(hint('stratless update'))}${C.dim('.')}\n`);
    return;
  }
