/**
 * WHERE ONE RECORD'S DERIVED STATE LIVES — the shelf, one per assistant.
 *
 * The doctrine this layout enforces (Sun, 2026-08-03): moments are never compared across records.
 * A vocabulary, a centroid, a category, a count, a verdict, a voice — every derived thing belongs
 * to ONE HUMAN+AI pair, because it was measured inside that relationship and describes no other.
 * The engine stays agnostic — the same code runs for any record — but nothing it derives is shared.
 *
 * Filesystem separation is the enforcement, not a convention: a per-record cold build CANNOT
 * retire another record's categories or truncate its assignments, because it cannot even name
 * their files. The bug class dies at the path level rather than being guarded per call site.
 *
 * The pile itself (`moments.jsonl`) stays one file — it is the partition SOURCE, each moment
 * carrying its `record` — and the raw transcripts belong to the tools. Everything derived lands
 * under `~/.stratless/records/<record-id>/`.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The base under which every record's shelf lives. Override with STRATLESS_RECORDS_DIR (tests). */
export function recordsRoot(): string {
  return process.env.STRATLESS_RECORDS_DIR || join(homedir(), '.stratless', 'records');
}

/**
 * One record's shelf. The id is a registry id ('claude-code', 'codex') — compiled in, never user
 * input — but the guard stays because a path component built from a variable earns one: a record id
 * with a separator in it would silently escape the shelf.
 */
export function recordDir(record: string): string {
  if (!record || /[/\\]|\.\./.test(record)) throw new Error(`not a record id: ${JSON.stringify(record)}`);
  return join(recordsRoot(), record);
}
