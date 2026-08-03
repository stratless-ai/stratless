/**
 * SHORTHAND — the decode-key extractor, pinned. Pure, offline. The rules that matter: a distinctive
 * opening surfaces, a corpus-common one is filtered by lift, nested phrases collapse to the short
 * form, the 3-conversation floor holds, project is excluded, and the numbered-reply shape is caught.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Labelled } from './count.js';
import type { Category } from './categories.js';
import { signatures, phrasesOf, isMachineArtifact, NUMBERED } from './shorthand.js';

let seq = 0;
const lab = (session: string, kinds: string[], reply: string): Labelled => ({
  moment: { key: `k${seq++}`, session, record: 'claude-code', ts: '2026-07-01T10:00:00Z', pile: 'ordinary', reply, replyLen: reply.length },
  kinds,
});
const cat = (name: string, scope?: string): Category => ({ name, description: name, bornAt: '2026-06-01T00:00:00Z', ...(scope ? { scope } : {}) });

test('phrasesOf: openings, a short whole reply, and the numbered-list marker', () => {
  assert.ok(phrasesOf('double check the merge please').includes('double check'));
  assert.ok(phrasesOf('sure').includes('sure'));
  assert.ok(phrasesOf('1. yes 2. no').includes(NUMBERED));
  assert.ok(!phrasesOf('just a normal longer sentence about something else').includes(NUMBERED));
});

test('signatures: a distinctive opening surfaces; a corpus-common one is filtered by lift', () => {
  seq = 0;
  const labelled: Labelled[] = [];
  for (let i = 0; i < 4; i++) labelled.push(lab(`v${i}`, ['verify'], `double check the merge ${i}`));
  for (let i = 0; i < 3; i++) labelled.push(lab(`w${i}`, ['verify'], `can you verify this ${i}`));
  for (let i = 0; i < 40; i++) labelled.push(lab(`o${i}`, ['other'], `can you help with this ${i}`));
  const verify = signatures(labelled, [cat('verify'), cat('other')]).find((s) => s.name === 'verify')!;
  assert.ok(verify.phrases.includes('double check'), 'the distinctive opening surfaces');
  assert.ok(!verify.phrases.includes('can you'), 'the corpus-common opening is filtered by lift');
});

test('signatures: nested phrases collapse to the canonical short form', () => {
  seq = 0;
  const labelled: Labelled[] = [];
  for (let i = 0; i < 4; i++) labelled.push(lab(`s${i}`, ['verify'], `double check on the merge ${i}`));
  for (let i = 0; i < 20; i++) labelled.push(lab(`o${i}`, ['other'], `unrelated message ${i}`));
  const verify = signatures(labelled, [cat('verify'), cat('other')]).find((s) => s.name === 'verify')!;
  assert.ok(verify.phrases.includes('double check'), 'kept the short canonical form');
  assert.ok(!verify.phrases.some((p) => p.startsWith('double check on')), 'dropped the longer nested forms');
});

test('signatures: a phrase confined to one conversation is not a habit', () => {
  seq = 0;
  const labelled: Labelled[] = [];
  for (let i = 0; i < 4; i++) labelled.push(lab('same-conv', ['planning'], `make a plan for ${i}`));
  for (let i = 0; i < 20; i++) labelled.push(lab(`o${i}`, ['other'], `unrelated ${i}`));
  assert.equal(signatures(labelled, [cat('planning'), cat('other')]).find((s) => s.name === 'planning'), undefined);
});

test('signatures: project-scoped categories are excluded', () => {
  seq = 0;
  const labelled: Labelled[] = [];
  for (let i = 0; i < 4; i++) labelled.push(lab(`p${i}`, ['ui'], `make it 14px ${i}`));
  for (let i = 0; i < 20; i++) labelled.push(lab(`o${i}`, ['other'], `x ${i}`));
  assert.equal(signatures(labelled, [cat('ui', 'project'), cat('other')]).find((s) => s.name === 'ui'), undefined);
});

test('signatures: the numbered-reply shape becomes a decode-key entry', () => {
  seq = 0;
  const labelled: Labelled[] = [];
  for (let i = 0; i < 4; i++) labelled.push(lab(`n${i}`, ['numbered'], `1. yes ${i}\n2. no`));
  for (let i = 0; i < 20; i++) labelled.push(lab(`o${i}`, ['other'], `a normal reply ${i}`));
  const numbered = signatures(labelled, [cat('numbered'), cat('other')]).find((s) => s.name === 'numbered')!;
  assert.ok(numbered.phrases.includes(NUMBERED), 'the structural signature fires');
});

test('signatures: an all-stopword opening never qualifies, however distinctive', () => {
  seq = 0;
  const labelled: Labelled[] = [];
  for (let i = 0; i < 5; i++) labelled.push(lab(`s${i}`, ['chatty'], 'ok so we do it')); // pure filler
  for (let i = 0; i < 20; i++) labelled.push(lab(`o${i}`, ['other'], `open${i} with a unique lead`));
  assert.equal(signatures(labelled, [cat('chatty'), cat('other')]).find((s) => s.name === 'chatty'), undefined);
});

test('signatures: a shared phrase decodes to only its most-distinctive category', () => {
  seq = 0;
  const labelled: Labelled[] = [];
  for (let i = 0; i < 5; i++) labelled.push(lab(`r${i}`, ['reason'], 'why is the build failing'));
  for (let i = 0; i < 25; i++) labelled.push(lab(`rf${i}`, ['reason'], `lead${i} unique padding text`));
  for (let i = 0; i < 5; i++) labelled.push(lab(`d${i}`, ['drift'], 'why is that happening'));
  for (let i = 0; i < 35; i++) labelled.push(lab(`df${i}`, ['drift'], `tail${i} unique padding text`));
  for (let i = 0; i < 500; i++) labelled.push(lab(`o${i}`, ['other'], `z${i} unrelated filler here`));
  const sigs = signatures(labelled, [cat('reason'), cat('drift'), cat('other')]);
  const reason = sigs.find((s) => s.name === 'reason');
  const drift = sigs.find((s) => s.name === 'drift');
  assert.ok(reason?.phrases.includes('why is'), '"why is" goes to the category that uses it most distinctively');
  assert.ok(!drift || !drift.phrases.includes('why is'), 'and not to the weaker one');
});

test('signatures: a phrase ending on a dangling word yields to its content-bearing form', () => {
  seq = 0;
  const labelled: Labelled[] = [];
  for (let i = 0; i < 5; i++) labelled.push(lab(`p${i}`, ['plan'], 'make a plan for it'));
  for (let i = 0; i < 200; i++) labelled.push(lab(`o${i}`, ['other'], `z${i} unrelated filler here`));
  const plan = signatures(labelled, [cat('plan'), cat('other')]).find((s) => s.name === 'plan')!;
  assert.ok(plan.phrases.includes('make a plan'), 'kept the content-bearing form');
  assert.ok(!plan.phrases.includes('make a'), 'dropped the dangling short form');
});

test('the machine\'s own name is an artifact of pasting, not speech', () => {
  const machine = { text: ' jxs macbook air local jx ', leads: new Set(['jxs', 'jx']) };
  assert.equal(isMachineArtifact('jxs macbook', machine), true, 'a hostname fragment is filtered');
  assert.equal(isMachineArtifact('jxs macbook air web', machine), true, 'hostname + the prompt cwd is still a paste — the lead word convicts it');
  assert.equal(isMachineArtifact('jx', machine), true, 'the bare username is filtered');
  assert.equal(isMachineArtifact('double check', machine), false, 'real speech passes');
  assert.equal(isMachineArtifact('macbook air is slow', machine), false, 'talking ABOUT the machine is speech — only prompt-lead openings are pastes');
  assert.equal(isMachineArtifact(NUMBERED, machine), false, 'the structural marker is never an artifact');
});
