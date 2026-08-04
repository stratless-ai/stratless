/**
 * THE SEAM INVARIANT — the one rule that makes a second assistant cheap, enforced instead of hoped.
 *
 * The rule (`contracts.ts`): a Record produces `Turn`s and the waist does everything else, so adding an
 * assistant costs one file per leg and NO edits to the engine.
 *
 * This existed as a shell command someone typed by hand — `grep -ril claude` over the engine files —
 * which is not a gate at all. It also failed at the job twice over, and both failures are what this
 * file is shaped by:
 *
 *  · IT WAS THE WRONG WORD. A tool's vocabulary leaks as its TOOL NAMES, which contain no such
 *    string. The grep was clean while `mirror.ts` counted handoffs by looking for tools literally
 *    called `Task`, `Agent` and `Skill` — so a Codex user's skills row was extracted correctly and
 *    then silently thrown away at render. That is why `Turn` carries neutral counts now, and why
 *    the check below reads for VOCABULARY rather than for one vendor's name.
 *
 *  · IT PUNISHED PROSE. Comments naming a tool are usually the most valuable lines in the file:
 *    they record which real archive taught us a rule. A word-grep makes those unwritable, so the
 *    checks here strip comments first. History stays; dependencies do not.
 *
 * A failure here is not a lint. It means the boundary moved, and the fix is the boundary rather than
 * the symptom.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Works from the source tree and from dist/integrations/contracts.test.js, independent of cwd.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

/**
 * THE WAIST. Everything from a moment being recorded to a profile being written — all of it reads
 * `Turn`s and must not know whose tool produced them.
 */
const ENGINE = [
  'pipeline/moments.ts', 'pipeline/exchange.ts', 'pipeline/shape.ts', 'pipeline/embedding/embed.ts',
  'pipeline/cluster.ts', 'pipeline/name.ts', 'pipeline/count.ts', 'pipeline/write.ts',
  'pipeline/lift.ts', 'pipeline/asks.ts', 'pipeline/voiced.ts', 'pipeline/engine.ts',
  'pipeline/refresh.ts', 'mirror/mirror.ts',
];

/** Source with comments removed, so a line of history never fails a check about dependencies. */
function code(file: string): string {
  return readFileSync(join(SRC, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments, including the long headers
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments, without eating `https://`
}

const namedIntegrationImports = (source: string): RegExpMatchArray | null =>
  source.match(/from ['"][^'"]*integrations\/(?:assistants\/[^/'"]+\/|brains\/(?!registry\.js['"])[^/'"]+\.js)/g);

test('the dependency guard recognizes named assistant and named brain imports', () => {
  assert.ok(namedIntegrationImports("import { x } from '../integrations/assistants/codex/record.js'"));
  assert.ok(namedIntegrationImports("import { x } from '../integrations/brains/claude-code.js'"));
  assert.equal(namedIntegrationImports("import { x } from '../integrations/assistants/registry.js'"), null);
  assert.equal(namedIntegrationImports("import { x } from '../integrations/brains/registry.js'"), null);
});

test('no pipeline file imports a named assistant or brain implementation', () => {
  // The strongest form of the rule, and the unambiguous one: an import is a dependency, not a
  // turn of phrase. If `moments.ts` ever imports `record-claude-code.js`, the waist has grown a
  // tool and the next assistant stops being one file per leg.
  for (const f of ENGINE) {
    const bad = namedIntegrationImports(code(f));
    assert.equal(bad, null, `${f} imports a per-tool module (${bad?.join(', ')}) — the seam has leaked`);
  }
});

test('no engine file speaks one tool\'s vocabulary in its executable code', () => {
  // THE LEAK THE OLD GREP COULD NOT SEE. These are the names one assistant happens to use; another
  // uses different ones for the same thing, so reading for them discards its data silently. What
  // the engine may ask is "how many handoffs" (`Turn.delegationCount`), never "were there any
  // called Task".
  const VOCAB = /'(Task|Agent|Skill|ExitPlanMode|EnterPlanMode|exec_command|apply_patch|claude|codex)'/gi;
  for (const f of ENGINE) {
    const bad = code(f).match(VOCAB);
    assert.equal(bad, null, `${f} names a specific tool's vocabulary (${bad?.join(', ')}) — ask the Turn instead`);
  }
});

test('the contracts module itself depends on nothing', () => {
  // `contracts.ts` is the line between the two halves. An import here would put a tool on both sides of
  // its own boundary.
  const imports = code('integrations/contracts.ts').match(/from '[^']+'/g) ?? [];
  assert.deepEqual(imports, [], 'contracts.ts must import nothing at all, tool-specific or otherwise');
});

test('every compiled adapter assembles all three legs', () => {
  // Cheap structural proof that a new entry is complete. A leg quietly missing is how an assistant
  // ends up half-supported: read but never refreshed, or armed but never loaded.
  for (const adapter of ['claude-code', 'codex']) {
    const source = code(`integrations/assistants/${adapter}/adapter.ts`);
    for (const leg of ['record:', 'rhythm:', 'load:']) {
      assert.ok(source.includes(leg), `${adapter} declares its ${leg.slice(0, -1)} leg`);
    }
  }
});
