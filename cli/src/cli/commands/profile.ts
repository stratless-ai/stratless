import { existsSync, readFileSync } from 'node:fs';
import type { Adapter } from '../../integrations/contracts.js';
import { detect as detectAdapters, loadedInto, registry } from '../../integrations/assistants/registry.js';
import { humanMdPath, profilePath } from '../../storage/profile.js';
import { latestRender, readRenders, type RenderMeta } from '../../runner/state.js';
import { C, hint } from '../ui.js';

/**
 * EACH DETECTED PAIR'S FILE, as every look-surface needs it: the assistant, its own profile path,
 * whether that file exists yet, and whether the tool is actually carrying it. One profile per pair
 * (the per-record doctrine) — there is no "the" artifact to ask about any more.
 *
 * THE LEGACY FALLBACK: a machine upgraded but not yet rebuilt has no pair files and one merged
 * `HUMAN.md` still serving. Surfaces show that file, honestly labelled by its own stamp, until the
 * consented rebuild replaces it — an upgrade must never present as amnesia.
 */
export function pairFiles(): { a: Adapter; path: string; exists: boolean; loaded: boolean }[] {
  return detectAdapters().map((a) => {
    const path = profilePath(a.record.id);
    let loaded = false;
    try {
      loaded = a.load.loaded();
    } catch {
      /* unreadable reads as not-loaded */
    }
    return { a, path, exists: existsSync(path), loaded };
  });
}

/** Is anything loaded anywhere? The on-at-all question — per-pair detail is the surfaces' job. */
export function profileLoaded(): boolean {
  try {
    const pairs = pairFiles();
    return (pairs.some((p) => p.exists) || existsSync(humanMdPath())) && loadedInto().length > 0;
  } catch {
    return false; // treat unreadable as not-loaded
  }
}

/** The `# built` stamp inside ONE loaded file — WHICH build that assistant is actually reading,
 *  not just whether one is. undefined when the file is absent or predates the stamp (pre-0.4.0). */
export function loadedBuiltStamp(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8').slice(0, 400).match(/^# built (.+)$/m)?.[1]?.trim();
  } catch {
    return undefined;
  }
}

/** The one honest footer a look shares — who is carrying their pair's file, who is still missing it. */
function lookFooter(): void {
  const pairs = pairFiles();
  const carrying = pairs.filter((p) => p.loaded).map((p) => p.a.displayName);
  const missing = pairs.filter((p) => p.exists && !p.loaded).map((p) => p.a.displayName);
  console.log(
    !carrying.length
      ? `  ${C.it('not loaded yet')} ${C.dim('· load it into your assistant:')} ${C.b(hint('stratless update'))}`
      : missing.length
        ? `  ${C.dim(`loaded into ${carrying.join(' and ')} · not in ${missing.join(' or ')} — load it: ${hint('stratless update')}`)}`
        : `  ${C.dim(`loaded into ${carrying.join(' and ')} · refresh with \`${hint('stratless update')}\``)}`,
  );
  console.log('');
}

/**
 * The profiler — LOOKING IS FREE (Sun's design decision, and it is now literal).
 *
 * `profile` prints the LAST BUILT rendering instantly, at zero spend, under a header carrying that
 * build's own date and numbers (from the sidecar — never recomputed at print). `profile` looks,
 * `update` builds and loads.
 *
 * Before the discovery pipeline it kept a build path for the first-ever look, which meant a command
 * whose whole promise is "free" could quietly start spending. With the build moving to `update` that
 * path is gone: nothing built yet now says so and points at the command that does spend.
 */
/** A build's ISO timestamp as a readable, globalized version stamp: `2026-07-23 12:28 UTC`. UTC so it
 *  reads the same anywhere; minute precision because a person checks "am I on the latest?", not ms. */
export function builtStamp(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

export async function profile(): Promise<void> {
  // ONE PROFILE PER PAIR: `profile` prints every detected relationship, each under the assistant's
  // name. The legacy merged file stands in for the interim between an upgrade and the first
  // consented per-record rebuild.
  const all = pairFiles();

  const renders = readRenders();
  const printOne = (file: string, title: string, meta: { builtAt: string; sessions: number; exchanges: number } | undefined): void => {
    const raw = readFileSync(file, 'utf8').split('\n');
    const start = raw.findIndex((l) => l.trim() !== '' && !/^\s*#/.test(l) && !/^\s*<!--/.test(l));
    const body = raw.slice(start === -1 ? 0 : start).join('\n').trimEnd();
    const header = meta
      ? `(stratless · built ${builtStamp(meta.builtAt)} · ${meta.sessions} sessions · ${meta.exchanges.toLocaleString()} moments)`
      : '(stratless · your profile)';
    console.log(`\n  ${C.b(title)}   ${C.dim(header)}\n`);
    console.log(body.split('\n').map((l) => `  ${l}`).join('\n'));
  };

  const havePair = all.filter((p) => p.exists);
  if (havePair.length) {
    for (const p of havePair) {
      printOne(p.path, all.length > 1 ? `WHO YOU'RE WORKING WITH · ${p.a.displayName}` : "WHO YOU'RE WORKING WITH", renders.profiles?.[p.a.record.id]);
    }
    const thin = all.filter((p) => !p.exists);
    for (const p of thin) {
      console.log(`\n  ${C.b(`WHO YOU'RE WORKING WITH · ${p.a.displayName}`)}   ${C.dim('not enough history yet — keep working in it')}`);
    }
  } else if (existsSync(humanMdPath())) {
    // The interim: upgraded, not yet rebuilt per pair. Show the merged-era file as what it is.
    printOne(humanMdPath(), "WHO YOU'RE WORKING WITH", readRenders().profile);
    console.log(`\n  ${C.dim(`from the merged era — \`${hint('stratless update')}\` rebuilds one profile per assistant`)}`);
  } else {
    console.log(`\n  ${C.it('Nothing built yet.')} ${C.dim('\`profile\` only ever looks — it never spends.')}`);
    console.log(`  ${C.dim('Build and load it with:')} ${C.b(hint('stratless update'))}\n`);
    return;
  }
  console.log(`\n  ${C.dim('free — this is the last build')}`);
  lookFooter();
}
