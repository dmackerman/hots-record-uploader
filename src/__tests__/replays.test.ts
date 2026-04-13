/**
 * Tests for replay directory detection and new-file filtering.
 */
jest.mock('fs');
jest.mock('../main/glob-helper');

import * as fs from 'fs';
import * as path from 'path';
import { detectReplayDir, listReplays, findNewReplays } from '../main/replays';
import { glob } from '../main/glob-helper';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockGlob = glob as jest.MockedFunction<typeof glob>;

describe('replays', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('detectReplayDir', () => {
    it('returns the first matching directory', () => {
      mockGlob.mockReturnValueOnce(['/Users/test/Library/Application Support/Blizzard/Heroes of the Storm/Accounts/123/456/Replays/Multiplayer']);
      const result = detectReplayDir();
      expect(result).toContain('Replays/Multiplayer');
    });

    it('returns null when no directory matches', () => {
      mockGlob.mockReturnValue([]);
      const result = detectReplayDir();
      expect(result).toBeNull();
    });
  });

  describe('listReplays', () => {
    it('returns .StormReplay files from a directory', () => {
      mockFs.readdirSync.mockReturnValue([
        'game1.StormReplay',
        'game2.StormReplay',
        'thumbs.db',
        'notes.txt',
      ] as unknown as fs.Dirent[]);

      const result = listReplays('/replays');
      expect(result).toHaveLength(2);
      expect(result[0]).toBe(path.join('/replays', 'game1.StormReplay'));
      expect(result[1]).toBe(path.join('/replays', 'game2.StormReplay'));
    });

    it('handles case-insensitive extension matching', () => {
      mockFs.readdirSync.mockReturnValue([
        'game1.stormreplay',
        'game2.STORMREPLAY',
        'game3.StormReplay',
      ] as unknown as fs.Dirent[]);

      const result = listReplays('/replays');
      expect(result).toHaveLength(3);
    });

    it('returns empty array for missing directory', () => {
      mockFs.readdirSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = listReplays('/nonexistent');
      expect(result).toEqual([]);
    });

    it('returns empty array for empty directory', () => {
      mockFs.readdirSync.mockReturnValue([]);
      const result = listReplays('/empty');
      expect(result).toEqual([]);
    });
  });

  describe('findNewReplays', () => {
    it('filters out already-uploaded files', () => {
      mockFs.readdirSync.mockReturnValue([
        'game1.StormReplay',
        'game2.StormReplay',
        'game3.StormReplay',
      ] as unknown as fs.Dirent[]);

      const uploaded = new Set(['game1.StormReplay', 'game2.StormReplay']);
      const result = findNewReplays('/replays', uploaded);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(path.join('/replays', 'game3.StormReplay'));
    });

    it('returns all replays when none are uploaded', () => {
      mockFs.readdirSync.mockReturnValue([
        'game1.StormReplay',
        'game2.StormReplay',
      ] as unknown as fs.Dirent[]);

      const result = findNewReplays('/replays', new Set());
      expect(result).toHaveLength(2);
    });

    it('returns empty when all are already uploaded', () => {
      mockFs.readdirSync.mockReturnValue([
        'game1.StormReplay',
      ] as unknown as fs.Dirent[]);

      const uploaded = new Set(['game1.StormReplay']);
      const result = findNewReplays('/replays', uploaded);
      expect(result).toEqual([]);
    });

    it('compares by basename only, ignoring path differences', () => {
      mockFs.readdirSync.mockReturnValue([
        'game1.StormReplay',
      ] as unknown as fs.Dirent[]);

      // The uploaded set stores basenames, not full paths
      const uploaded = new Set(['game1.StormReplay']);
      const result = findNewReplays('/different/path', uploaded);
      expect(result).toEqual([]);
    });

    it('handles directory read errors gracefully', () => {
      mockFs.readdirSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = findNewReplays('/nonexistent', new Set());
      expect(result).toEqual([]);
    });
  });
});
