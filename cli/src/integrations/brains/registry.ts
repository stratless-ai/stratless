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
import type { Brain } from '../contracts.js';
import { claudeBrain } from './claude-code.js';
import { codexBrain } from './codex.js';

/** Every brain stratless knows how to borrow, in preference order. */
export const brains: readonly Brain[] = [claudeBrain, codexBrain];

/**
 * WHICH BRAIN BELONGS TO WHICH ASSISTANT'S HISTORY — a mapping, deliberately not an identity.
 *
 * A Record id and a brain id look alike and are not the same thing: `claude-code` is a place
 * transcripts live, `claude` is a model that can be asked a question. Keeping the correspondence
 * here, in one table, is what stops the two registries quietly fusing into one — which is the
 * mistake the seam exists to prevent (a machine reading Codex history with a Claude brain must stay
 * expressible). A Record with no brain of its own is not an error; it simply has no opinion.
 */
const BRAIN_OF_RECORD: Readonly<Record<string, string>> = { 'claude-code': 'claude', codex: 'codex' };

/**
 * The brain that belongs to an assistant's own history — Codex history, Codex brain. `brainFor`
 * below is the resolver that applies it per pair; this is the bare mapping.
 */
export function brainForRecord(recordId: string): Brain | undefined {
  const id = BRAIN_OF_RECORD[recordId];
  return id ? brains.find((b) => b.id === id) : undefined;
}

/** The ones usable on this machine right now. */
export function detectBrains(): Brain[] {
  return brains.filter((b) => b.detect());
}

/**
 * THE BRAIN FOR ONE PAIR'S BUILD — the rule, wired (Sun, 2026-08-03): Codex profile, Codex brain;
 * Claude Code profile, Claude Code brain. A pair's file is worded by the assistant the relationship
 * is WITH, because the voice is part of the pair.
 *
 * Three rungs, in order:
 *   1. `STRATLESS_BRAIN` — an explicit override outranks the rule everywhere (tests, debugging,
 *      a person who simply prefers one voice). Naming an absent brain resolves to nothing, never
 *      to a substitute.
 *   2. The record's own brain, when its binary is installed — the rule itself.
 *   3. The first PRESENT brain — the fallback that keeps a Codex-history machine with no `codex`
 *      binary building at all: a profile in a borrowed voice beats a wall, and the render stamp
 *      records which voice actually ran (it is how the unwired rule was caught).
 */
export function brainFor(record: string): Brain | undefined {
  const pinned = process.env.STRATLESS_BRAIN;
  if (pinned) return brains.find((b) => b.id === pinned && b.detect());
  const own = brainForRecord(record);
  if (own?.detect()) return own;
  return detectBrains()[0];
}

/** ANY brain at all — the record-less question ("is there anything to borrow?", the spend label).
 *  Build-path voice choices go through `brainFor(record)`; this must never decide a pair's voice. */
export function pickBrain(): Brain | undefined {
  const pinned = process.env.STRATLESS_BRAIN;
  if (pinned) return brains.find((b) => b.id === pinned && b.detect());
  return detectBrains()[0];
}
