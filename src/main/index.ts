/**
 * Electron main process entry point.
 * Wires up the watcher, uploader, tray, and IPC handlers.
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { HotsWatcher } from './watcher';
import { detectReplayDir, findNewReplays } from './replays';
import { ReplayUploader, UploadProgress, UploadResult } from './uploader';
import { createTray, updateTrayMenu } from './tray';
import { registerIpcHandlers, getStore, markFilesUploaded } from './ipc';

// Handle Squirrel events (Windows installer lifecycle)
if (require('electron-squirrel-startup')) {
  app.quit();
}

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

app.isQuitting = false;

let mainWindow: BrowserWindow | null = null;
const watcher = new HotsWatcher();
let lastResult: UploadResult | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 520,
    resizable: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  return win;
}

function getPendingCount(): number {
  const store = getStore();
  const settings = store.get('settings');
  const replayDir = settings.replayDir;
  if (!replayDir) return 0;
  const uploadedSet = new Set(store.get('uploadedFiles'));
  return findNewReplays(replayDir, uploadedSet).length;
}

function sendStatus(state?: string) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('status-update', {
    state: state || watcher.getState(),
    uploadProgress: null,
    lastResult,
    pendingCount: getPendingCount(),
  });
}

// ── Upload cycle ──

async function runUploadCycle() {
  const store = getStore();
  const settings = store.get('settings');

  if (!settings.battletag) {
    watcher.resetToIdle();
    return;
  }

  // Resolve replay directory
  let replayDir = settings.replayDir;
  if (!replayDir) {
    replayDir = detectReplayDir() || '';
    if (replayDir) {
      store.set('settings.replayDir', replayDir);
    }
  }

  if (!replayDir) {
    lastResult = {
      gamesAdded: 0,
      duplicates: 0,
      errors: 0,
      userId: null,
      errorMessage: 'No replay directory configured. Go to Settings to set one.',
    };
    sendStatus('idle');
    watcher.resetToIdle();
    return;
  }

  // Find new replays
  const uploadedSet = new Set(store.get('uploadedFiles'));
  let newReplays: string[];
  try {
    newReplays = findNewReplays(replayDir, uploadedSet);
  } catch {
    lastResult = {
      gamesAdded: 0,
      duplicates: 0,
      errors: 0,
      userId: null,
      errorMessage: `Cannot read replay directory: ${replayDir}`,
    };
    sendStatus('idle');
    watcher.resetToIdle();
    return;
  }

  if (newReplays.length === 0) {
    lastResult = { gamesAdded: 0, duplicates: 0, errors: 0, userId: null };
    sendStatus('idle');
    watcher.resetToIdle();
    return;
  }

  // Upload
  watcher.setState('uploading');
  updateTrayMenu(
    'uploading',
    `Uploading ${newReplays.length} replay${newReplays.length !== 1 ? 's' : ''}...`
  );

  const uploader = new ReplayUploader(settings.battletag);

  uploader.on('progress', (progress: UploadProgress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status-update', {
        state: 'uploading',
        uploadProgress: progress,
        lastResult,
        pendingCount: 0,
      });
    }
    updateTrayMenu('uploading', `Uploading ${progress.current}/${progress.total}...`);
  });

  const result = await uploader.uploadReplays(newReplays);
  lastResult = result;

  // Persist userId for profile link
  if (result.userId) {
    getStore().set('userId', result.userId);
  }

  // Mark uploaded
  const uploadedNames = newReplays.map((p) => path.basename(p));
  markFilesUploaded(uploadedNames);

  sendStatus('idle');
  watcher.resetToIdle();
  updateTrayMenu('idle');
}

// ── App lifecycle ──

app.whenReady().then(() => {
  registerIpcHandlers();

  mainWindow = createWindow();
  createTray(mainWindow);

  // Auto-detect replay directory on first launch
  const store = getStore();
  const settings = store.get('settings');
  if (!settings.replayDir) {
    const detected = detectReplayDir();
    if (detected) {
      store.set('settings.replayDir', detected);
    }
  }

  // Wire up watcher events
  watcher.on('state', (state: string) => {
    sendStatus(state);
    updateTrayMenu(state as import('./watcher').WatcherState);
  });

  watcher.on('scan', () => {
    const currentSettings = store.get('settings');
    if (currentSettings.autoUpload) {
      runUploadCycle();
    } else {
      watcher.resetToIdle();
    }
  });

  // Start watching if battletag is configured
  if (settings.battletag) {
    watcher.start();
  }

  // Send current state once the renderer is ready
  mainWindow.webContents.on('did-finish-load', () => {
    sendStatus();
  });

  // Handle manual upload trigger
  ipcMain.handle('upload-now', async () => {
    if (watcher.getState() === 'uploading') return;
    watcher.setState('scanning');
    await runUploadCycle();
  });

  // Re-start watcher when settings change
  ipcMain.on('settings-saved', () => {
    const updated = store.get('settings');
    if (updated.battletag && watcher.getState() === 'idle') {
      watcher.start();
    }
  });
});

app.on('window-all-closed', () => {
  // Don't quit on macOS unless explicitly quitting
  if (process.platform !== 'darwin') {
    // On Windows, keep running in tray
  }
});

app.on('activate', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  watcher.stop();
});
