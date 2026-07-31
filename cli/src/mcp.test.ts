/**
 * THE MCP SURFACE, PINNED.
 *
 * Everything here is a promise a connected assistant depends on, and two of them are measured facts
 * rather than opinions: the connect-time hook must stay inside the truncation ceiling (2048 chars in
 * Claude Code, budgeted to 1024), and the server must never write anything to stdout that is not a
 * JSON-RPC frame — one stray line breaks the person's whole session.
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test, before, after } from 'node:test';

import { handle, hook, serve, profileText, TOOL, HOOK_BUDGET } from './mcp.js';

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'stratless-mcp-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const res = (o: object | null): { result?: Record<string, unknown>; error?: unknown } =>
  (o ?? {}) as { result?: Record<string, unknown>; error?: unknown };

test('initialize: the hook rides the response and stays inside the measured ceiling', () => {
  const r = res(handle({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }));
  const instructions = r.result?.instructions as string;
  assert.ok(instructions.includes('who_am_i'), 'the hook asks for the one call that carries the payload');
  assert.ok(instructions.length <= HOOK_BUDGET, `hook is ${instructions.length} chars, budget ${HOOK_BUDGET}`);
  // The real wall, measured 2026-07-30: Claude Code cuts this field at exactly 2048 characters.
  assert.ok(instructions.length < 2048, 'a hook cut mid-sentence would be a wrong instruction');
  assert.equal(r.result?.protocolVersion, '2025-06-18', "the client's own version is echoed, never argued with");
});

test('initialize: a client that names no version still gets a handshake', () => {
  const r = res(handle({ id: 1, method: 'initialize', params: {} }));
  assert.equal(typeof r.result?.protocolVersion, 'string');
});

test('the hook is a hook, never the profile — this channel truncates', () => {
  // 2048 chars of profile would arrive as 2048 chars of profile and then stop, mid-row. The rule is
  // that the connect-time rung says what to CALL; the tool rung carries what to KNOW.
  assert.ok(!hook().includes('##'), 'no profile headings leak into the hook');
  assert.ok(!/\(\d+×/.test(hook()), 'no receipts either — those belong to the payload');
});

test('tools/list: exactly one tool, and it is read-only by construction', () => {
  const tools = res(handle({ id: 2, method: 'tools/list' })).result?.tools as { name: string; description: string }[];
  assert.equal(tools.length, 1, 'one verb: nothing here can mutate anything');
  assert.equal(tools[0].name, 'who_am_i');
  // Creed measured clients truncating tool descriptions around 1024; ours stays well under.
  assert.ok(tools[0].description.length < 1024, `description is ${tools[0].description.length} chars`);
});

test('tools/call: the profile is served verbatim, read at call time', () => {
  const f = join(dir, 'HUMAN.md');
  writeFileSync(f, '# Who you are working with\n\n- talk tersely (268×)\n');
  const r = res(handle({ id: 3, method: 'tools/call', params: { name: 'who_am_i' } }, f));
  const content = r.result?.content as { text: string }[];
  assert.ok(content[0].text.includes('talk tersely (268×)'), 'the real rows arrive, receipts included');
  assert.equal(r.result?.isError, undefined, 'a served profile is not an error');
});

test('tools/call: a rebuilt profile is live with nothing to re-inject', () => {
  const f = join(dir, 'live.md');
  writeFileSync(f, 'first build');
  const before = (res(handle({ id: 4, method: 'tools/call', params: { name: 'who_am_i' } }, f)).result?.content as { text: string }[])[0].text;
  writeFileSync(f, 'second build');
  const after = (res(handle({ id: 5, method: 'tools/call', params: { name: 'who_am_i' } }, f)).result?.content as { text: string }[])[0].text;
  assert.equal(before, 'first build');
  assert.equal(after, 'second build', 'read at call time, so a flush reaches every connected client at once');
});

test('REFUSE, DO NOT INVENT: no profile yet is said plainly and flagged as an error', () => {
  const r = res(handle({ id: 6, method: 'tools/call', params: { name: 'who_am_i' } }, join(dir, 'nope.md')));
  const content = r.result?.content as { text: string }[];
  assert.equal(r.result?.isError, true);
  assert.ok(/stratless update/.test(content[0].text), 'it names the remedy');
  assert.ok(/unknown/i.test(content[0].text), 'and tells the model to treat the person as unknown rather than guess');
});

test('an empty profile file is refused too, not served as a blank person', () => {
  const f = join(dir, 'empty.md');
  writeFileSync(f, '   \n');
  assert.equal(profileText(f).isError, true);
});

test('an unknown tool is refused without pretending to serve it', () => {
  const r = res(handle({ id: 7, method: 'tools/call', params: { name: 'write_profile' } }));
  assert.equal(r.result?.isError, true);
});

test('notifications are never answered — a reply to one is a protocol violation', () => {
  assert.equal(handle({ method: 'notifications/initialized' }), null);
  assert.equal(handle({ method: 'notifications/cancelled', params: {} }), null);
});

test('an unimplemented method with an id gets an error, not silence', () => {
  const r = res(handle({ id: 8, method: 'completion/complete' }));
  assert.ok(r.error, 'a client waiting on an id must never hang');
});

test('resources and prompts answer empty rather than erroring', () => {
  assert.deepEqual(res(handle({ id: 9, method: 'resources/list' })).result, { resources: [] });
  assert.deepEqual(res(handle({ id: 10, method: 'prompts/list' })).result, { prompts: [] });
});

test('STDOUT IS THE PROTOCOL: a malformed frame is dropped, the session survives', async () => {
  const input = new PassThrough();
  const out = new PassThrough();
  const chunks: string[] = [];
  out.on('data', (c: Buffer) => chunks.push(c.toString()));

  const done = serve(input, out);
  input.write('not json at all\n');
  input.write('\n'); // a blank line is not a frame either
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);
  input.end();
  await done;

  const lines = chunks.join('').trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 1, 'exactly one frame out for one valid frame in');
  const parsed = JSON.parse(lines[0]) as { id: number; result: { tools: unknown[] } };
  assert.equal(parsed.id, 1, 'and it answers the request that survived');
  assert.equal(parsed.result.tools.length, 1);
});

test('every frame written is parseable JSON-RPC — no banner, no spinner, no stray log', async () => {
  const input = new PassThrough();
  const out = new PassThrough();
  const chunks: string[] = [];
  out.on('data', (c: Buffer) => chunks.push(c.toString()));

  const done = serve(input, out);
  for (const m of [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ]) {
    input.write(`${JSON.stringify(m)}\n`);
  }
  input.end();
  await done;

  const lines = chunks.join('').trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 2, 'the notification produced no frame');
  for (const l of lines) {
    const o = JSON.parse(l) as { jsonrpc: string };
    assert.equal(o.jsonrpc, '2.0');
  }
});

test('the tool name is stable — a client config names it, so a rename is a breaking change', () => {
  assert.equal(TOOL.name, 'who_am_i');
});
