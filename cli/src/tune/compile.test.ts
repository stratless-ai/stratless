/**
 * The guide's contract, hermetically: injected findings, injected ask, no disk, no model. The
 * gate rejects every ungrounded shape with a reason; receipts are code-stamped; digits live in
 * the Receipts section and nowhere else; an unparseable or silent brain yields an empty sitting.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { dispose, guidePrompt, renderProposal, consult, GUIDE_CAP } from './compile.js';
import type { EvidenceItem, Proposal } from './compile.js';
import type { Finding } from './derive.js';

const finding = (over: Partial<Finding> & { id: string }): Finding => ({
  kind: 'ritual',
  claim: 'after staging, the commit and the log check follow as one motion',
  receipts: { count: 283, sessions: 88 },
  exemplars: [{ session: 's1', hash: 'h1', quote: 'merged. watch the ci' }],
  detail: { tokens: ['git add', 'git commit', 'git log'] },
  ...over,
});

const ev = (): EvidenceItem[] => [
  { id: 'ritual:claude-code:aaaa', kind: 'ritual', claim: 'the commit chain', receipts: { count: 283 }, quotes: ['merged. watch the ci'] },
  { id: 'rule:claude-code:bbbb', kind: 'rule', claim: 'the standing demand', receipts: { count: 7 }, quotes: ['do not push until i say'] },
  { id: 'lesson:claude-code:cccc', kind: 'lesson', claim: 'the costly episode', receipts: { corrections: 7 }, quotes: ['topped up jina and it still failed'] },
];

const proposal = (over: Partial<Proposal> & { name: string }): Proposal => ({
  kind: 'skill',
  description: 'Fires when the user says merged.',
  standard: 'The commit is never left unwatched.',
  moves: ['run the ci watch', 'report the verdict'],
  citations: ['ritual:claude-code:aaaa'],
  ...over,
});

test('the gate accepts a grounded proposal and rejects each ungrounded shape with a reason', () => {
  const d = dispose(
    [
      proposal({ name: 'watch-the-ci' }),
      proposal({ name: 'no-evidence', citations: [] }),
      proposal({ name: 'fake-evidence', citations: ['ritual:claude-code:zzzz'] }),
      proposal({ name: 'digit-prose', standard: 'Do it 3 times.' }),
      proposal({ name: 'Bad Name!' }),
      proposal({ name: 'composed-quote', quote: 'he said merged. watch the ci carefully please' }),
      proposal({ name: 'real-quote', citations: ['ritual:claude-code:aaaa'], quote: 'merged. watch the ci' }),
    ],
    ev(),
    [],
  );
  const verdicts = Object.fromEntries(d.map((x) => [x.proposal.name, x.ok]));
  assert.equal(verdicts['watch-the-ci'], true);
  assert.equal(verdicts['no-evidence'], false);
  assert.equal(verdicts['fake-evidence'], false);
  assert.equal(verdicts['digit-prose'], false);
  assert.equal(verdicts['Bad Name!'], false);
  assert.equal(verdicts['composed-quote'], false, 'a real fragment wrapped in composed words dies');
  assert.equal(verdicts['real-quote'], true, 'a verbatim quote from cited evidence lives');
  for (const x of d) if (!x.ok) assert.ok(x.reasons.length, `${x.proposal.name} rejected without a reason`);
});

test('fan-out: one finding backs at most two accepted proposals, and rejections consume no budget', () => {
  const cite = ['rule:claude-code:bbbb'];
  const d = dispose(
    [
      proposal({ name: 'first', citations: cite }),
      proposal({ name: 'rejected-anyway', citations: cite, standard: 'has a 9 in it' }),
      proposal({ name: 'second', citations: cite }),
      proposal({ name: 'third', citations: cite }),
    ],
    ev(),
    [],
  );
  const verdicts = Object.fromEntries(d.map((x) => [x.proposal.name, x.ok]));
  assert.equal(verdicts['first'], true);
  assert.equal(verdicts['rejected-anyway'], false);
  assert.equal(verdicts['second'], true, 'the rejected proposal must not have consumed the budget');
  assert.equal(verdicts['third'], false);
});

test('the cap holds and every over-cap proposal is reported, never dropped', () => {
  const names = ['a-one', 'a-two', 'a-three', 'a-four', 'a-five', 'a-six', 'a-seven'];
  const cites = ['ritual:claude-code:aaaa', 'rule:claude-code:bbbb', 'lesson:claude-code:cccc'];
  const d = dispose(
    names.map((name, i) => proposal({ name, citations: [cites[Math.floor(i / 2) % 3]!] })),
    ev(),
    [],
  );
  assert.equal(d.length, names.length, 'nothing silently dropped');
  assert.equal(d.filter((x) => x.ok).length, GUIDE_CAP);
  for (const x of d.filter((x) => !x.ok)) assert.ok(x.reasons.length);
});

test('an installed skill name is never duplicated', () => {
  const d = dispose([proposal({ name: 'plan-first' })], ev(), [{ name: 'plan-first', description: 'plans first' }]);
  assert.equal(d[0]!.ok, false);
});

test('a rendered proposal carries code-stamped receipts and digits nowhere else', () => {
  const art = renderProposal(
    proposal({ name: 'watch-the-ci', quote: 'merged. watch the ci' }),
    ev(),
    'claude-code',
  );
  assert.equal(art.filename, 'watch-the-ci/SKILL.md');
  assert.ok(art.content.includes('ritual:claude-code:aaaa: count 283'));
  assert.ok(art.content.includes('"merged. watch the ci"'));
  const beforeReceipts = art.content.split('## Receipts')[0]!;
  assert.equal(/[0-9]/.test(beforeReceipts), false, 'digits live only in the receipts section');
  const style = renderProposal(proposal({ name: 'terse-register', kind: 'style' }), ev(), 'claude-code');
  assert.equal(style.filename, 'terse-register/SKILL.md', 'a style is an always-on skill in the pack — never a memory write');
  assert.ok(style.content.includes('Always on.'));
  assert.ok(style.content.startsWith('---\nname: terse-register'));
});

test('the seven levers stand in the guide prompt — a future edit cannot silently drop one', () => {
  const p = guidePrompt(ev(), []);
  assert.ok(p.includes('Prefer skills that DO something'), 'the acting bias');
  assert.ok(p.includes('one thing it must NOT be used for'), 'the anti-trigger');
  assert.ok(p.includes('the LAST move is the self-test'), 'the self-test ending');
  assert.ok(p.includes('do the thing, then stop'), 'the terminal state');
  assert.ok(p.includes('evidence marked [patch]'), 'the slip-class instruction');
  assert.ok(p.includes('never all-caps'), 'the register guard');
  assert.ok(p.includes('at most five skills'), 'the cap holds at five (Sun, 2026-08-11)');
});

test('the guide prompt carries every evidence id and the installed list', () => {
  const p = guidePrompt(ev(), [{ name: 'plan-first', description: 'shapes work before it starts' }]);
  for (const e of ev()) assert.ok(p.includes(e.id));
  assert.ok(p.includes('plan-first'));
});

test('consult: one injected call, grounded proposals become artifacts, garbage becomes an empty sitting', () => {
  const f = finding({ id: 'ritual:claude-code:aaaa', exemplars: [{ session: 's', hash: 'h', quote: 'merged. watch the ci' }], detail: {} });
  const good = consult('claude-code', [f], [], () =>
    JSON.stringify({ proposals: [proposal({ name: 'watch-the-ci', citations: ['ritual:claude-code:aaaa'] })] }),
  );
  assert.equal(good.artifacts.length, 1);
  assert.equal(good.disposed.filter((x) => x.ok).length, 1);

  const garbage = consult('claude-code', [f], [], () => 'not json at all');
  assert.equal(garbage.artifacts.length, 0);

  const silent = consult('claude-code', [f], [], () => undefined);
  assert.equal(silent.artifacts.length, 0, 'no brain answer means an empty sitting, never an invented skill');
});

test('a previous tune of ours never collides — re-proposing a minted skill refreshes, theirs still blocks', () => {
  const d = dispose(
    [proposal({ name: 'merged-watch-ci' }), proposal({ name: 'plan-first' })],
    ev(),
    [
      { name: 'merged-watch-ci', description: 'watches ci after merges', minted: true },
      { name: 'plan-first', description: 'plans before work' },
    ],
  );
  const verdicts = Object.fromEntries(d.map((x) => [x.proposal.name, x.ok]));
  assert.equal(verdicts['merged-watch-ci'], true, 'ours refreshes in place — the re-run contract');
  assert.equal(verdicts['plan-first'], false, 'theirs still blocks by name');
});

test('the guide prompt separates theirs from ours, and only theirs is marked never-duplicate', () => {
  const p = guidePrompt(ev(), [
    { name: 'their-skill', description: 'the person installed this' },
    { name: 'our-minted', description: 'a previous sitting wrote this', minted: true },
  ]);
  const neverDup = p.indexOf('ALREADY INSTALLED');
  const refreshable = p.indexOf('MINTED BY A PREVIOUS SITTING');
  assert.ok(neverDup !== -1 && refreshable !== -1);
  assert.ok(p.indexOf('their-skill') > neverDup && p.indexOf('their-skill') < refreshable);
  assert.ok(p.indexOf('our-minted') > refreshable);
});
