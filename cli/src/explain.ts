/**
 * Tier 1 — say what it MEANS.
 *
 * Tier 0 quotes the assistant's own words back at you. Those words are jargon — "a 30-day JWT
 * with no refresh rotation" — which is precisely the thing that makes people feel stupid. So
 * Tier 1 restates the decision as a CONSEQUENCE: what happens, to whom, that you would feel.
 *
 * ⭐ NO API KEY. We borrow the assistant you already have.
 * Most people run Claude Code on a subscription and have no ANTHROPIC_API_KEY at all — a
 * BYO-key requirement would block the majority of users at the door. But `claude` is already
 * installed and already authenticated, so we shell out to it in --print mode. Their model,
 * their auth, their machine. Nothing new to sign up for, no bill, no proxy.
 *
 * If there's no assistant CLI, we degrade to Tier 0 and say nothing. We never invent.
 */
import { execFileSync } from 'node:child_process';
import type { Edit } from './transcript.js';

/** Is a borrowable assistant CLI on PATH? */
export function findAssistant(): string | undefined {
  for (const bin of ['claude']) {
    try {
      execFileSync('which', [bin], { stdio: ['ignore', 'pipe', 'ignore'] });
      return bin;
    } catch {
      /* not installed — try the next */
    }
  }
  return undefined;
}

const PROMPT = `You are explaining one decision an AI coding assistant made, to the person who
owns this product but does NOT read code.

Rules — these are absolute:
- ONE sentence. Two at most.
- State the CONSEQUENCE, not the mechanism. Not "it uses a 30-day JWT with no refresh" but
  "users get silently logged out after a month and you'd never see an error."
- Plain words. No jargon. If you must name a technical thing, say what it does.
- Only describe what is IN the code below. Invent nothing.
- If the code does not support a clear consequence, reply exactly: UNCLEAR
- No preamble, no "This code...", no markdown. Just the sentence.`;

/**
 * Ask the user's own assistant what this decision costs them.
 * Returns undefined if we can't answer honestly — silence beats a guess.
 */
export function explain(edit: Edit, line: string, bin: string): string | undefined {
  const input = [
    PROMPT,
    '',
    `The person asked for: "${edit.prompt.replace(/\s+/g, ' ').slice(0, 300)}"`,
    `The line they are asking about: ${line}`,
    '',
    'The code the assistant wrote:',
    '```',
    edit.body.slice(0, 4000),
    '```',
  ].join('\n');

  // Summarising one decision doesn't need a frontier model — a small one is faster and
  // cheaper on the user's own plan. Fall back to their default if the alias isn't recognised.
  for (const args of [['-p', '--model', 'haiku', input], ['-p', input]]) {
    try {
      const out = execFileSync(bin, args, {
        encoding: 'utf8',
        timeout: 120_000, // the CLI has real startup cost; 60s silently degraded every call
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 1024 * 1024,
      }).trim();

      // Refuse rather than guess. A confidently wrong consequence is the one failure that
      // would end this product, so an unusable answer must produce nothing at all.
      if (!out || out.includes('UNCLEAR') || out.length > 400) return undefined;
      return out.replace(/^["']|["']$/g, '');
    } catch {
      /* try the fallback; if both fail we degrade to Tier 0 and say nothing */
    }
  }
  return undefined;
}
