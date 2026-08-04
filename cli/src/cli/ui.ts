import { makePalette } from './palette.js';

// Results style by stdout's TTY, progress by stderr's.
export const C = makePalette(process.stdout);
export const CE = makePalette(process.stderr);

/** Was this invoked through npx, where the bare executable may not be on PATH? */
export const viaNpx = (): boolean => (process.argv[1] ?? '').includes('_npx') || process.env.npm_command === 'exec';

/** A command hint that actually runs in the shell the person has. */
export const hint = (cmd: string): string => (viaNpx() ? `npx ${cmd}` : cmd);

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Start a zero-dependency spinner for a discrete wait and return its stop function. */
export function startSpinner(label: string, stream: NodeJS.WriteStream = process.stderr): () => void {
  const pal = stream === process.stdout ? C : CE;
  if (!stream.isTTY) {
    stream.write(`  ${pal.dim(label)}\n`);
    return () => {};
  }
  let i = 0;
  stream.write('\x1B[?25l');
  const draw = (): void => {
    i = (i + 1) % SPINNER_FRAMES.length;
    stream.write(`\r  ${pal.ok(SPINNER_FRAMES[i])} ${pal.dim(label)}`);
  };
  draw();
  const id = setInterval(draw, 100);
  return () => {
    clearInterval(id);
    stream.write(`\r${' '.repeat(label.length + 6)}\r\x1B[?25h`);
  };
}
