/**
 * Replay directory discovery and new-file detection.
 *
 * Auto-detects the HoTS replay directory, tracks which files have been
 * uploaded, and returns only new replay files.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { glob } from './glob-helper';

/** Default replay directory patterns by platform. */
function getDefaultReplayPatterns(): string[] {
  if (process.platform === 'win32') {
    const docs = path.join(os.homedir(), 'Documents');
    return [path.join(docs, 'Heroes of the Storm', 'Accounts', '*', '*', 'Replays', 'Multiplayer')];
  } else if (process.platform === 'darwin') {
    return [
      path.join(
        os.homedir(),
        'Library',
        'Application Support',
        'Blizzard',
        'Heroes of the Storm',
        'Accounts',
        '*',
        '*',
        'Replays',
        'Multiplayer'
      ),
    ];
  }
  return [];
}

/** Try to auto-detect the replay directory. Returns the first match or null. */
export function detectReplayDir(): string | null {
  const patterns = getDefaultReplayPatterns();
  for (const pattern of patterns) {
    const matches = glob(pattern);
    if (matches.length > 0) {
      return matches[0];
    }
  }
  return null;
}

/** List all .StormReplay files in a directory. */
export function listReplays(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.stormreplay'))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/** Given a directory and a set of already-uploaded filenames, return new replay paths. */
export function findNewReplays(dir: string, uploaded: Set<string>): string[] {
  return listReplays(dir).filter((fullPath) => {
    const name = path.basename(fullPath);
    return !uploaded.has(name);
  });
}
