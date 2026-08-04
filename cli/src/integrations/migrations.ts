import { reaimIfLoaded } from './assistants/claude-code/load.js';
import { migrateLegacyProfile } from '../storage/profile.js';

/**
 * Carry a merged-era Claude Code install across the artifact move before any command resolves a
 * profile path. The storage layer moves the file; this integration layer re-aims the assistant that
 * used to own it, but only when its existing import proves the profile was still loaded.
 */
export function migrateLegacyInstall(): void {
  if (migrateLegacyProfile()) reaimIfLoaded();
}
