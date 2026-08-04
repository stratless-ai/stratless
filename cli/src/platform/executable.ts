import { execFileSync } from 'node:child_process';

/** Is an executable available on the current PATH? */
export function onPath(bin: string): boolean {
  try {
    execFileSync('which', [bin], { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}
