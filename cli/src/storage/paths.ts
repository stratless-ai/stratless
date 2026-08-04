import { homedir } from 'node:os';
import { join } from 'node:path';

/** The shared transcript vault; each Record decides which slice it owns. */
export const archiveRoot = (): string => join(homedir(), '.stratless', 'archive');
