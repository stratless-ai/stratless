import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Adapter } from '../../integrations/contracts.js';
import { brains, pickBrain } from '../../integrations/brains/registry.js';
import { anyArmed, detect as detectAdapters } from '../../integrations/assistants/registry.js';
import { fetchLatest, newerThan } from '../../runner/notify.js';
import { humanMdPath, installedVersion, profilePath } from '../../storage/profile.js';
import { loadRecentExchanges } from '../../pipeline/exchange.js';
import { JUDGE_WINDOW } from '../../runner/loop.js';
import { loadMoments } from '../../pipeline/moments.js';
import { loadCategories } from '../../pipeline/categories.js';
import { estimateBuild, estimateLine } from '../../pipeline/estimate.js';
import { latestRender, readRenders, readState, type RenderMeta } from '../../runner/state.js';
import { readUsage } from '../../runner/usage.js';
import { readLock, lockIsStale } from '../../runner/worker.js';
import { readProgress } from '../../runner/progress.js';
import { readInstalledBlocks, readInstalledSkills } from '../../tune/inspect.js';
import { C, hint, startSpinner } from '../ui.js';

/**
 * STATUS — stratless's own state, and what it has cost. This answers "is stratless on, is the
 * evidence current, what is installed, and how much of my own plan has it spent?" Every line is
 * read locally and for free — it spends nothing.
 */

/** A build's ISO timestamp as a readable, globalized version stamp: `2026-07-23 12:28 UTC`. UTC so it
 *  reads the same anywhere; minute precision because a person checks "am I on the latest?", not ms. */
export function builtStamp(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

/** The `# built` stamp inside one evidence file — WHICH build it carries, not just whether one
 *  exists. undefined when the file is absent or predates the stamp (pre-0.4.0). */
function fileBuiltStamp(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8').slice(0, 400).match(/^# built (.+)$/m)?.[1]?.trim();
  } catch {
    return undefined;
  }
}

/** Each detected pair's evidence file — one per pair (the per-record doctrine), internal, the
 *  sitting's input. Exported for `stop`, which names what it keeps. */
export function pairFiles(): { a: Adapter; path: string; exists: boolean }[] {
  return detectAdapters().map((a) => {
    const path = profilePath(a.record.id);
    return { a, path, exists: existsSync(path) };
  });
}
export async function status(rest: string[] = []): Promise<void> {
  // `--check` is the everyone-door for version news: user-initiated, on-screen, announced.
  // Plain `status` stays fully offline — the trust posture is not tunable.
  if (rest.includes('--check')) {
    const stopCheck = startSpinner('checking npm for a newer version…');
    const latest = await fetchLatest();
    stopCheck();
    const installed = installedVersion();
    if (!latest) console.log(`  ${C.warn('could not reach the registry')} ${C.dim('(offline? try again later)')}\n`);
    else if (newerThan(latest, installed))
      console.log(`  installed ${C.b(installed)} · latest ${C.b(latest)} — update: ${C.b('npm i -g stratless')}\n`);
    else console.log(`  ${C.ok('up to date')} ${C.dim(`(installed ${installed} = latest)`)}\n`);
    return;
  }

  // 1. Is the after-session refresh installed? (the Stop hook we write into settings.json)
  const refresh = anyArmed();

  // 2. The evidence files — internal, per pair; the sitting reads them, nobody imports them.
  const human = humanMdPath();
  const humanExists = existsSync(human);

  // 3. The recent-builds trajectory — newest first, from the sidecar's history. Each stamp is the
  //    SAME one HUMAN.md carries in its `# built` header, so status and the file can never disagree.
  //    Fall back to the single latest render (a sidecar written before history), then to the file's
  //    mtime, so an old install still shows something honest.
  const renders = readRenders();
  const builds = renders.history?.length ? renders.history : renders.profile ? [renders.profile] : [];
  let mtimeStamp = '';
  try {
    if (!builds.length && humanExists) mtimeStamp = statSync(human).mtime.toISOString().slice(0, 10);
  } catch {
    /* leave blank */
  }

  const u = readUsage();
  // Tokens are the honest unit — a subscription spends quota, not dollars — and the cache tokens
  // (the ~17–24k harness overhead every borrowed call carries) ARE the consumption, so they count.
  // The dollar figure is the API-equivalent, labelled as exactly that.
  const tokens = u.inputTokens + u.outputTokens + u.cacheCreationTokens + u.cacheReadTokens;
  const fmtTok = (t: number): string =>
    t >= 1e6 ? `${(t / 1e6).toFixed(1)}M` : t >= 1000 ? `${Math.round(t / 1000)}k` : String(t);
  // Split lifetime spend into the LIVE engine stages and everything RETIRED. The dead keys roll into
  // ONE honest line instead of a column of dead labels; the total still counts them, so the sum never
  // lies — only the clutter is gone. A fresh user has no retired spend and never sees that line.
  //
  // `discover` and `assign` joined the retired set on 2026-07-26: v3 replaced them with `build` (the
  // cold run: shape, fingerprint, cluster, name) and `grow` (placing new moments — free). Anyone who
  // ran a previous version still has that spend on their meter, and it must keep a readable label
  // rather than disappearing or printing a raw key.
  const RETIRED = new Set(['judge', 'synthesis', 'miner', 'audit', 'grade', 'discover', 'assign', 'rules', 'knowledge']);
  const STAGE_LABEL: Record<string, string> = { build: 'building', grow: 'placing', name: 'naming', write: 'writing', lift: 'patch voicing' };
  let retiredUsd = 0;
  const stageParts: string[] = [];
  for (const [f, t] of Object.entries(u.byFeature)) {
    if (RETIRED.has(f)) retiredUsd += t.costUsd;
    else stageParts.push(`${STAGE_LABEL[f] ?? f} $${t.costUsd.toFixed(2)}`);
  }

  console.log(`\n  ${C.b('stratless status')}\n`);
  console.log(`    after-session refresh   ${refresh ? C.ok('on') : C.dim('off')}`);
  console.log(`    auto-rebuild            ${C.dim(`${readState().flushCadence ?? 'weekly'} · set with \`${hint('stratless update --daily|--weekly')}\``)}`);
  // The cold-start onramp: history collected but the paid build not yet run. Derived, never stored —
  // no categories on disk while the pile holds moments means "free read live, full build pending".
  try {
    const pile = loadMoments();
    for (const a of detectAdapters()) {
      const own = pile.filter((m) => m.record === a.record.id);
      if (loadCategories(a.record.id).length || !own.length) continue;
      const est = estimateLine(estimateBuild(own.length));
      console.log(`    profile build           ${C.warn('not run yet')}  ${C.dim(`${a.displayName} · ${est} — run ${hint('stratless update')}`)}`);
    }
  } catch {
    /* stores absent on a brand-new machine — nothing to report */
  }
  // Phase 2: a live worker is visible here — the tail's Ctrl-C message points people HERE.
  {
    const holder = readLock();
    const wp = readProgress();
    if (holder && !lockIsStale(holder)) {
      const ph = wp && wp.pid === holder.pid ? wp.phase : 'working';
      console.log(`    running now             ${C.ok('yes')}  ${C.dim(`${ph} · pid ${holder.pid} · stop: ${hint('stratless stop')}`)}`);
    } else {
      if (wp && wp.phase === 'stopped') {
        console.log(`    last run                ${C.it('stopped by you')}`);
      } else if (wp && wp.phase === 'failed') {
        console.log(`    last run                ${C.warn('failed')}  ${C.dim(wp.summary?.[0] ?? '')}`);
      }
    }
  }
  // THE EVIDENCE — which build each pair's internal file carries. Per pair, each with its own
  // `# built` stamp; never loaded anywhere, so the only claims here are "exists" and "how fresh".
  {
    const pairs = pairFiles();
    if (!pairs.length) {
      console.log(`    evidence                ${humanExists ? C.ok('built') : C.dim('none yet')}${humanExists ? `  ${C.dim(human)}` : ''}`);
    } else {
      const w = Math.max(...pairs.map((p) => p.a.displayName.length));
      pairs.forEach((p, i) => {
        const rowLabel = (i === 0 ? 'evidence' : '').padEnd(24);
        const stamp = p.exists ? fileBuiltStamp(p.path) : undefined;
        const note = p.exists ? C.dim(stamp ? `built ${stamp} · ${p.path}` : p.path) : C.dim('— not enough history yet');
        console.log(`    ${rowLabel}${p.a.displayName.padEnd(w + 2)}${p.exists ? C.ok('yes') : C.dim('no ')}  ${note}`);
      });
    }
  }
  // THE TUNE — what a sitting actually installed, counted from the mint mark on disk, across
  // every detected pair's own skill door (plus the legacy block dirs of older installs).
  {
    const home = homedir();
    const mintedSkills = readInstalledSkills(detectAdapters().map((a) => a.skillsDir())).filter((s) => s.minted);
    const mintedBlocks = readInstalledBlocks([join(home, '.stratless', 'tune'), join(home, '.stratless', 'tune', 'claude-code')]).filter(
      (b) => b.minted,
    );
    const n = mintedSkills.length + mintedBlocks.length;
    console.log(
      n
        ? `    tune installed          ${C.ok('yes')}  ${C.dim(`${mintedSkills.length} skill${mintedSkills.length === 1 ? '' : 's'}${mintedBlocks.length ? ` + ${mintedBlocks.length} style block${mintedBlocks.length === 1 ? '' : 's'}` : ''} · refresh: ${hint('stratless tune')}`)}`
        : `    tune installed          ${C.dim('no')}   ${C.dim(`the sitting proposes one: ${hint('stratless tune')}`)}`,
    );
    // OUR names, named — what stratless put on a machine should be visible without opening
    // folders. Only ours: classifying the person's own skills would be a claim about files we
    // do not own.
    if (mintedSkills.length) {
      console.log(`                            ${C.dim(mintedSkills.map((s) => s.name).join(' · '))}`);
    }
  }

  // RECENT BUILDS — when each pair last updated, and how its pile is growing. Per record, because
  // each pair rebuilds on its own clock; the legacy merged history stands in until the first
  // per-record build exists, so an upgraded machine never presents as amnesia.
  {
    const renders = readRenders();
    const here = detectAdapters();
    let printed = false;
    const show = (label: string | undefined, hist: RenderMeta[]): void => {
      if (!printed) console.log(`\n    recent builds`);
      printed = true;
      if (label) console.log(`      ${C.dim(label)}`);
      for (const [i, b] of hist.slice(0, 5).entries()) {
        const cats = b.categories != null ? ` · ${b.categories} categories` : '';
        const tag = i === 0 ? `   ${C.dim('(latest)')}` : '';
        console.log(`      ${builtStamp(b.builtAt)}   ${C.dim(`${b.sessions.toLocaleString()} conv · ${b.exchanges.toLocaleString()} moments${cats}`)}${tag}`);
      }
    };
    // Each record's OWN trajectory first. The merged-era history belongs to no single record —
    // attributing it to each would print the same builds once per assistant, claiming twice —
    // so it shows ONCE, labelled as the era it is, while it is still the only history there is.
    for (const a of here) {
      const own = renders.histories?.[a.record.id];
      if (own?.length) show(here.length > 1 ? a.displayName : undefined, own);
    }
    const legacy = renders.history ?? (renders.profile ? [renders.profile] : []);
    if (legacy.length && here.some((a) => !renders.histories?.[a.record.id]?.length)) {
      show('from the merged era', legacy);
    }
    if (!printed) console.log(`    last built              ${C.dim(mtimeStamp || 'never')}`);
  }

  // SPEND — lifetime total, the live stages, the retired miner era rolled into one line, the most
  // recent run's receipt, and the meter's own blind spots (silent accounting would be the bug).
  const lastRunSpend = readProgress()?.spend;
  console.log(`\n    spend`);
  console.log(`      total          ${C.b(`$${u.costUsd.toFixed(2)}`)}  ·  ${fmtTok(tokens)} tokens  ·  ${u.calls.toLocaleString()} calls  ${C.dim(`on your own ${brains.filter((b) => b.detect()).length > 1 ? 'assistants' : (pickBrain()?.displayName ?? 'assistant')}`)}`);
  if (stageParts.length) console.log(`      by stage       ${C.dim(stageParts.join(' · '))}`);
  if (retiredUsd > 0.005) console.log(`      retired        ${C.dim(`$${retiredUsd.toFixed(2)}  (earlier miner stages)`)}`);
  if (lastRunSpend) console.log(`      last run       ${C.dim(lastRunSpend.replace('this run: ', ''))}`);
  const gaps: string[] = [];
  if (u.unmeteredCalls) gaps.push(`${u.unmeteredCalls} unmetered (true cost unknown)`);
  if (u.pinEscapedCalls) gaps.push(`${u.pinEscapedCalls} pin-dropped`);
  if (gaps.length) console.log(`      flags          ${C.warn(gaps.join(' · '))}`);

  if (!refresh) console.log(`\n  ${C.dim(`Run \`${hint('stratless init')}\` to turn the after-session refresh back on.`)}`);
  console.log('');
}

