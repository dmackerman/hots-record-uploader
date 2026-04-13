/**
 * IPC handlers: bridge between main process and renderer.
 */
import { ipcMain, dialog, shell } from 'electron';
import * as fs from 'fs';
import Store from 'electron-store';

export interface AppSettings {
  battletag: string;
  replayDir: string;
  autoUpload: boolean;
}

export interface AppStatus {
  state: string;
  uploadProgress: {
    current: number;
    total: number;
    fileName: string;
    gamesAdded: number;
    duplicates: number;
    errors: number;
  } | null;
  lastResult: {
    gamesAdded: number;
    duplicates: number;
    errors: number;
    userId: string | null;
  } | null;
}

const store = new Store<{
  settings: AppSettings;
  uploadedFiles: string[];
  userId: string;
}>({
  defaults: {
    settings: {
      battletag: '',
      replayDir: '',
      autoUpload: true,
    },
    uploadedFiles: [],
    userId: '',
  },
});

export function getStore() {
  return store;
}

export function registerIpcHandlers(): void {
  ipcMain.handle('get-settings', () => {
    return store.get('settings');
  });

  ipcMain.handle('save-settings', (_event, settings: AppSettings) => {
    store.set('settings', settings);
  });

  ipcMain.handle('get-uploaded-files', () => {
    return store.get('uploadedFiles');
  });

  ipcMain.handle('clear-uploaded-cache', () => {
    store.set('uploadedFiles', []);
  });

  ipcMain.handle('browse-replay-dir', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Replay Directory',
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('open-external', (_event, url: string) => {
    shell.openExternal(url);
  });

  ipcMain.handle('get-user-id', () => {
    return store.get('userId');
  });

  ipcMain.handle(
    'validate-replay-dir',
    (_event, dir: string): { valid: boolean; count: number } => {
      try {
        const files = fs.readdirSync(dir);
        const count = files.filter((f) => f.toLowerCase().endsWith('.stormreplay')).length;
        return { valid: count > 0, count };
      } catch {
        return { valid: false, count: 0 };
      }
    }
  );
}

export function markFilesUploaded(fileNames: string[]): void {
  const current = store.get('uploadedFiles');
  const updated = [...new Set([...current, ...fileNames])];
  store.set('uploadedFiles', updated);
}
