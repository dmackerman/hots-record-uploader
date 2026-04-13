/**
 * Minimal synchronous glob for detecting replay directories.
 * Uses fs.readdirSync to expand * segments in a path pattern.
 */
import * as fs from 'fs';
import * as path from 'path';

export function glob(pattern: string): string[] {
  const sep = path.sep === '\\' ? /[\\/]/ : /\//;
  const segments = pattern.split(sep);
  return expandSegments(segments, 0, '');
}

function expandSegments(segments: string[], index: number, current: string): string[] {
  if (index >= segments.length) {
    // Reached end — check if the path exists
    try {
      fs.accessSync(current);
      return [current];
    } catch {
      return [];
    }
  }

  const seg = segments[index];

  if (seg === '*') {
    // Expand wildcard: list directory entries and recurse for each
    const dir = current || (process.platform === 'win32' ? segments[0] + path.sep : '/');
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const results: string[] = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          results.push(...expandSegments(segments, index + 1, path.join(dir, entry.name)));
        }
      }
      return results;
    } catch {
      return [];
    }
  }

  // Literal segment
  const next = current ? path.join(current, seg) : seg;
  return expandSegments(segments, index + 1, next);
}
