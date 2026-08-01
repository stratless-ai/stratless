/**
 * THE BRAINS — which borrowed models stratless can ask, and which of them this machine has.
 *
 * Three moments in a build need language rather than arithmetic: naming each pile, wording each
 * profile row, wording a LIFT rule. Everything else is computed locally. Those three shell out to
 * a CLI the person already has, on their own subscription — no API key, no bill from us.
 *
 * A BRAIN IS PROVIDER-BOUND, WHICH IS WHY IT LIVES HERE AND NOT ON AN ADAPTER. One brain can name
 * piles built from ANY assistant's history. The commonest machine there is reads a second
 * assistant's transcripts using the first assistant's model — putting a brain on `Adapter` would
 * make that machine unrepresentable. Records answer "whose history is this"; brains answer "who
 * can put it into words", and the two questions have different answers.
 *
 * ORDER IS THE POLICY, and it is stated rather than hidden: the first brain PRESENT wins. Claude
 * is first, so nobody who has it today sees any change — their profile keeps being written by the
 * same model it always was. A machine without it falls through to the next, which is the whole
 * point: someone who runs only Codex gets a real profile rather than a wall.
 *
 * Compiled in, never installed — same argument as the Record registry. This code reads a person's
 * conversations and then hands them to a model; the set of things allowed to do that stays small
 * enough to audit and stays ours.
 */
import type { Brain } from './seam.js';
import { claudeBrain } from './brain-claude-code.js';
import { codexBrain } from './brain-codex.js';

/** Every brain stratless knows how to borrow, in preference order. */
export const brains: readonly Brain[] = [claudeBrain, codexBrain];

/** The ones usable on this machine right now. */
export function detectBrains(): Brain[] {
  return brains.filter((b) => b.detect());
}

/**
 * THE ONE TO USE, or undefined when the person has nothing to borrow.
 *
 * `STRATLESS_BRAIN` pins the choice — which is how the CHOICE, and not merely a path, survives the
 * detached spawn. A worker inherits the hook's thin PATH, so it re-derives the brain from scratch;
 * without the pin, a machine with two brains could pick one in the foreground and the other in the
 * background, and a path alone cannot carry a protocol (handing Codex's binary to Claude's flag
 * vocabulary produces silence, not an error).
 */
export function pickBrain(): Brain | undefined {
  const pinned = process.env.STRATLESS_BRAIN;
  if (pinned) return brains.find((b) => b.id === pinned && b.detect());
  return detectBrains()[0];
}
