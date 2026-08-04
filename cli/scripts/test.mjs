import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function testsUnder(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? testsUnder(path) : path.endsWith('.test.js') ? [path] : [];
    })
    .sort();
}

const tests = testsUnder('dist');
if (!tests.length) {
  console.error('no compiled tests found under dist/ — run `npm run build` first');
  process.exit(1);
}

const run = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
process.exit(run.status ?? 1);
