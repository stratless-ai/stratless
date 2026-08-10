/**
 * INSPECTION — the shop checks what's already fitted before quoting (Solo V2, step 5).
 *
 * A real shop doesn't sell you a second intake. Before the door prints a prescription, every
 * derived unit is compared against what the machine already runs: the person's installed
 * skills (theirs — NEVER touched, and capable of covering a unit) and the harness's native
 * features (factory parts — a mint drives them, never rebuilds them). Comparison runs on the
 * DESCRIPTION surface — the text skills actually compete on at invocation time — through the
 * shipped embedding path, by arithmetic.
 *
 * Two kinds of installed skill, told apart by the mint mark ("Minted by stratless"):
 *   THEIRS — user-authored. A close-enough match covers the unit: verdict `already-fitted`,
 *   named and counted, nothing written, and the prescription VALIDATES their pick ("you were
 *   right to install it — here's the count"). The person's setup is the authority.
 *   OURS — a previous tune. Never counts as coverage (a tune replacing itself is an update,
 *   not a collision); the door diffs and re-installs these under the standing consent.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe } from './compile.js';
import type { Embedder } from './derive.js';
import type { DerivedUnit } from './derive.js';

/**
 * THE INSPECTION FLOOR — a named product dial, provisional like its siblings. Calibrated from
 * the measured landscape (2026-08-09 overlap run on the reference machine): known-distinct
 * same-family skills link 0.73–0.81; the closest genuinely-unrelated cross pairs sat ≤ 0.65.
 * A duplicate must clear the family band's floor. Re-derive when more machines exist.
 */
export const INSPECT_FLOOR = 0.75;

export const MINT_MARK = 'Minted by stratless';

export interface InstalledSkill {
  name: string;
  description: string;
  /** absolute path of the SKILL.md this came from */
  source: string;
  /** carries the mint mark — a previous tune of ours, not the person's own pick */
  minted: boolean;
}

/** Factory parts a mint must drive, never rebuild. Text approximates each feature's own
 *  discovery surface so the same arithmetic covers them. */
export const NATIVE_FEATURES: { name: string; text: string }[] = [
  {
    name: 'plan mode',
    text: 'enter a planning mode: explore read-only, write an implementation plan, and present it for approval before any code is changed',
  },
  {
    name: 'todo tracking',
    text: 'track multi-step work as a visible todo list, checking items off as each step completes',
  },
];

/** Read every SKILL.md under the given skills directories. Defensive throughout: a malformed
 *  file is skipped, an absent directory contributes nothing — inspection degrades to "less is
 *  known", never to a throw. */
export function readInstalledSkills(dirs: string[]): InstalledSkill[] {
  const out: InstalledSkill[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const file = join(dir, entry, 'SKILL.md');
      if (!existsSync(file)) continue;
      try {
        const raw = readFileSync(file, 'utf8');
        const fm = raw.match(/^---\n([\s\S]*?)\n---/);
        const d = fm?.[1]?.match(/description:\s*([\s\S]*?)(?=\n[a-zA-Z-]+:|$)/);
        const description = d?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
        if (!description) continue;
        out.push({ name: entry, description, source: file, minted: raw.includes(MINT_MARK) });
      } catch {
        /* unreadable — skip */
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
}

export interface InspectionVerdict {
  name: string;
  kind: DerivedUnit['kind'];
  verdict: 'mint' | 'already-fitted';
  /** who covers it: an installed skill's name, or a native feature's */
  coveredBy?: string;
  /** the link that decided it — the receipt for the seating */
  link?: number;
}

const dot = (a: Float32Array, b: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/**
 * Inspect every derived unit against the installed world. One embedding pass, nearest-cover
 * wins, floor-gated, deterministic ties by cover name. Minted-by-us installed skills are
 * excluded from coverage by construction.
 */
export async function inspectTune(
  units: DerivedUnit[],
  installed: InstalledSkill[],
  embed: Embedder,
): Promise<InspectionVerdict[]> {
  const covers = [
    ...installed.filter((s) => !s.minted).map((s) => ({ name: s.name, text: s.description })),
    ...NATIVE_FEATURES.map((n) => ({ name: n.name, text: n.text })),
  ];
  if (units.length === 0) return [];
  if (covers.length === 0)
    return units.map((u) => ({ name: u.anchor, kind: u.kind, verdict: 'mint' as const }));

  const vectors = await embed([...units.map((u) => describe(u)), ...covers.map((c) => c.text)]);
  const unitVec = (i: number): Float32Array => vectors[i]!;
  const coverVec = (i: number): Float32Array => vectors[units.length + i]!;

  return units.map((u, ui) => {
    let best: { name: string; link: number } | undefined;
    covers.forEach((c, ci) => {
      const link = dot(unitVec(ui), coverVec(ci));
      if (link < INSPECT_FLOOR) return;
      if (!best || link > best.link || (link === best.link && c.name < best.name)) best = { name: c.name, link };
    });
    return best
      ? { name: u.anchor, kind: u.kind, verdict: 'already-fitted' as const, coveredBy: best.name, link: best.link }
      : { name: u.anchor, kind: u.kind, verdict: 'mint' as const };
  });
}
