/**
 * Tests for IPC handlers and store operations.
 * Focuses on markFilesUploaded and store defaults.
 */
jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn() },
  dialog: { showOpenDialog: jest.fn() },
  shell: { openExternal: jest.fn() },
  app: { getVersion: jest.fn().mockReturnValue('1.0.0') },
}));

// electron-store is ESM — provide a full factory mock
const mockStoreData: Record<string, any> = {};
const mockGet = jest.fn((key: string) => {
  const keys = key.split('.');
  let val: any = mockStoreData;
  for (const k of keys) {
    val = val?.[k];
  }
  return val;
});
const mockSet = jest.fn((key: string, value: any) => {
  const keys = key.split('.');
  if (keys.length === 1) {
    mockStoreData[key] = value;
  } else {
    let obj: any = mockStoreData;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
  }
});

jest.mock('electron-store', () => {
  return jest.fn().mockImplementation(() => ({
    get: mockGet,
    set: mockSet,
  }));
});

import { getStore, markFilesUploaded, registerIpcHandlers } from '../main/ipc';

describe('ipc / store', () => {
  beforeEach(() => {
    // Reset store data
    Object.keys(mockStoreData).forEach((k) => delete mockStoreData[k]);
    mockStoreData.settings = {
      battletag: '',
      replayDir: '',
      autoUpload: true,
    };
    mockStoreData.uploadedFiles = [];
    mockStoreData.userId = '';
    mockGet.mockClear();
    mockSet.mockClear();
  });

  describe('getStore', () => {
    it('returns the store instance', () => {
      const store = getStore();
      expect(store).toBeDefined();
      expect(store.get).toBeDefined();
      expect(store.set).toBeDefined();
    });
  });

  describe('markFilesUploaded', () => {
    it('adds new filenames to the uploaded list', () => {
      mockStoreData.uploadedFiles = ['game1.StormReplay'];

      markFilesUploaded(['game2.StormReplay', 'game3.StormReplay']);

      expect(mockSet).toHaveBeenCalledWith(
        'uploadedFiles',
        expect.arrayContaining([
          'game1.StormReplay',
          'game2.StormReplay',
          'game3.StormReplay',
        ])
      );
    });

    it('deduplicates filenames', () => {
      mockStoreData.uploadedFiles = ['game1.StormReplay'];

      markFilesUploaded(['game1.StormReplay', 'game2.StormReplay']);

      const setCall = mockSet.mock.calls.find(
        (c: any[]) => c[0] === 'uploadedFiles'
      );
      const files = setCall[1] as string[];
      // Should have no duplicates
      expect(new Set(files).size).toBe(files.length);
      expect(files).toContain('game1.StormReplay');
      expect(files).toContain('game2.StormReplay');
    });

    it('handles empty input', () => {
      mockStoreData.uploadedFiles = ['game1.StormReplay'];

      markFilesUploaded([]);

      expect(mockSet).toHaveBeenCalledWith(
        'uploadedFiles',
        ['game1.StormReplay']
      );
    });
  });

  describe('registerIpcHandlers', () => {
    it('registers all expected IPC handlers', () => {
      const { ipcMain } = require('electron');
      (ipcMain.handle as jest.Mock).mockClear();

      registerIpcHandlers();

      const registeredChannels = (ipcMain.handle as jest.Mock).mock.calls.map(
        (call: any[]) => call[0]
      );

      expect(registeredChannels).toContain('get-settings');
      expect(registeredChannels).toContain('save-settings');
      expect(registeredChannels).toContain('get-uploaded-files');
      expect(registeredChannels).toContain('clear-uploaded-cache');
      expect(registeredChannels).toContain('browse-replay-dir');
      expect(registeredChannels).toContain('open-external');
      expect(registeredChannels).toContain('get-user-id');
      expect(registeredChannels).toContain('validate-replay-dir');
      expect(registeredChannels).toContain('get-version');
    });
  });
});
