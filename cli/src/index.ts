#!/usr/bin/env node
/** Published CLI bootstrap. Command behavior lives under `cli/`; this file keeps the npm bin stable. */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { main } from './cli/main.js';

export { isYes } from './cli/args.js';

function invokedAsCli(): boolean {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedAsCli()) void main();
