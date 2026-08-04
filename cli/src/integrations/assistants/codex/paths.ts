import { homedir } from 'node:os';
import { join } from 'node:path';
import { archiveRoot } from '../../../storage/paths.js';

export const codexHome = (): string => process.env.CODEX_HOME || join(homedir(), '.codex');
export const codexSessions = (): string => join(codexHome(), 'sessions');
export const archiveSlice = (): string => join(archiveRoot(), 'codex');
