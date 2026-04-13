/**
 * Tests for glob helper (sync glob for replay directory detection).
 */
jest.mock('fs');

import * as fs from 'fs';
import { glob } from '../main/glob-helper';

const mockFs = fs as jest.Mocked<typeof fs>;

describe('glob', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns matching paths for literal segments', () => {
    mockFs.accessSync.mockImplementation(() => undefined);

    const result = glob('/Users/test/Documents');
    // path.join drops the leading slash when joining empty initial segment
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Users/test/Documents');
  });

  it('returns empty when path does not exist', () => {
    mockFs.accessSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const result = glob('/nonexistent/path');
    expect(result).toEqual([]);
  });

  it('expands wildcard segments', () => {
    // /some/*/dir
    mockFs.readdirSync.mockReturnValue([
      { name: 'account1', isDirectory: () => true },
      { name: 'account2', isDirectory: () => true },
      { name: 'file.txt', isDirectory: () => false },
    ] as unknown as fs.Dirent[]);

    mockFs.accessSync.mockImplementation(() => undefined);

    const result = glob('/some/*/dir');
    expect(result).toHaveLength(2);
    expect(result).toContainEqual(expect.stringContaining('account1'));
    expect(result).toContainEqual(expect.stringContaining('account2'));
  });

  it('skips non-directory entries for wildcard segments', () => {
    mockFs.readdirSync.mockReturnValue([
      { name: 'file.txt', isDirectory: () => false },
    ] as unknown as fs.Dirent[]);

    const result = glob('/some/*/dir');
    expect(result).toEqual([]);
  });

  it('returns empty when wildcard directory cannot be read', () => {
    mockFs.readdirSync.mockImplementation(() => {
      throw new Error('EACCES');
    });

    const result = glob('/some/*/dir');
    expect(result).toEqual([]);
  });

  it('handles multiple wildcard segments', () => {
    // /base/*/sub/*/leaf
    let callCount = 0;
    mockFs.readdirSync.mockImplementation((_dir: any) => {
      callCount++;
      if (callCount <= 1) {
        // First wildcard
        return [
          { name: 'a', isDirectory: () => true },
        ] as unknown as fs.Dirent[];
      }
      // Second wildcard
      return [
        { name: 'x', isDirectory: () => true },
        { name: 'y', isDirectory: () => true },
      ] as unknown as fs.Dirent[];
    });
    mockFs.accessSync.mockImplementation(() => undefined);

    const result = glob('/base/*/sub/*/leaf');
    expect(result).toHaveLength(2);
  });
});
