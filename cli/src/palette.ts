/**
 * PALETTE — escape codes only when a human eye is watching.
 *
 * The rules (cli-guidelines-audit.md, confirmed against clig.dev + the NO_COLOR spec):
 * - Per-stream TTY gating: stdout's styling gates on stdout being a TTY; stderr's on stderr.
 *   `stratless status | grep x` must emit zero escape bytes on stdout while progress on a
 *   still-attached stderr may stay styled.
 * - NO_COLOR disables when SET AND NON-EMPTY (spec nuance: `NO_COLOR=""` does NOT disable).
 * - `TERM=dumb` disables.
 * - Documented deviation, stricter than spec: the NO_COLOR standard governs color only, but we
 *   strip bold/dim too when suppressed — if the output isn't for a human eye, no escape survives.
 */

export interface Palette {
  b: (s: string) => string;
  dim: (s: string) => string;
  you: (s: string) => string;
  it: (s: string) => string;
  ok: (s: string) => string;
  warn: (s: string) => string;
  bad: (s: string) => string;
}

/** Build a palette bound to one stream. Exported for tests (env is read at build time). */
export function makePalette(stream: { isTTY?: boolean }, env: NodeJS.ProcessEnv = process.env): Palette {
  const noColor = typeof env.NO_COLOR === 'string' && env.NO_COLOR !== '';
  const on = !!stream.isTTY && !noColor && env.TERM !== 'dumb';
  const wrap = (code: string) => (on ? (s: string) => `\x1b[${code}m${s}\x1b[0m` : (s: string) => s);
  return {
    b: wrap('1'),
    dim: wrap('2'),
    you: wrap('36'),
    it: wrap('33'),
    ok: wrap('32'),
    warn: wrap('33'),
    bad: wrap('31'),
  };
}
