/**
 * ATOMIC — the write that can never half-happen, and the read that refuses a damaged store.
 *
 * Phase 1 of the cold-start build (C2). Two rules, both about money:
 *
 *   1. Every store is written temp+rename. A kill -9 mid-write leaves the OLD file or the NEW
 *      file on disk, never a truncated one. rename(2) on the same filesystem is atomic; the temp
 *      lives next to its target so it never crosses a mount.
 *   2. A store that IS damaged (hand-edited, disk fault, another era's crash) refuses LOUDLY.
 *      The judgment cache is the record of every claude call ever paid for — reading corruption
 *      as "empty" would silently re-bill the person's entire history. Silence over a wrong
 *      answer, but never silence over a fresh bill.
 *
 * THE FILE STAYS THE PERSON'S FILE: rename(2) would happily replace a symlink with a plain file
 * and stamp it with the default umask — severing a dotfiles-repo link to ~/.claude/CLAUDE.md and
 * dropping a chmod the person chose. So the write follows symlinks to the real target (dangling
 * links get their pointed-at file created) and copies the existing file's mode onto the temp
 * before the rename. We replace CONTENT, never identity.
 *
 * Every store reads fail-open: a damaged file costs one rebuild or a meter line, never the pile —
 * the v3 engine made every artifact cheap to re-derive, so refusal (the v1-era CorruptStoreError)
 * retired with the $24 caches it protected.
 */
import { chmodSync, mkdirSync, readlinkSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/** Where a write should actually land: through every symlink to the real file. A dangling link
 *  resolves one hop to its pointed-at path (the write CREATES that file, as write-through would);
 *  a plain or missing path is itself. */
function writeTarget(file: string): string {
  try {
    return realpathSync(file); // exists — follow the whole chain
  } catch {
    try {
      return resolve(dirname(file), readlinkSync(file)); // dangling symlink — honor its target
    } catch {
      return file; // plain missing path
    }
  }
}

/**
 * Write a file so it is always wholly old or wholly new: write a sibling temp, match the old
 * file's mode, then rename over the target. The temp name carries the pid so two processes never
 * share one (the lock makes that near-impossible anyway; the pid makes it certain). A failed
 * write cleans its temp up.
 */
export function atomicWriteFileSync(file: string, data: string): void {
  const target = writeTarget(file);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`);
  try {
    writeFileSync(tmp, data);
    try {
      chmodSync(tmp, statSync(target).mode); // keep the person's chmod; a new file keeps the umask default
    } catch {
      /* no existing file to inherit from */
    }
    renameSync(tmp, target);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* the temp may never have been created */
    }
    throw err;
  }
}
