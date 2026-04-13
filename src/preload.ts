/**
 * Preload script: exposes a safe API to the renderer via contextBridge.
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  getSettings: () => Promise<{
    battletag: string;
    replayDir: string;
    autoUpload: boolean;
  }>;
  saveSettings: (settings: {
    battletag: string;
    replayDir: string;
    autoUpload: boolean;
  }) => Promise<void>;
  browseReplayDir: () => Promise<string | null>;
  openExternal: (url: string) => Promise<void>;
  onStatusChange: (callback: (status: unknown) => void) => void;
  uploadNow: () => Promise<void>;
  clearUploadedCache: () => Promise<void>;
  getUserId: () => Promise<string>;
  validateReplayDir: (dir: string) => Promise<{ valid: boolean; count: number }>;
  getVersion: () => Promise<string>;
}

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('save-settings', settings),
  browseReplayDir: () => ipcRenderer.invoke('browse-replay-dir'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  onStatusChange: (callback: (status: unknown) => void) => {
    ipcRenderer.on('status-update', (_event, status) => callback(status));
  },
  uploadNow: () => ipcRenderer.invoke('upload-now'),
  clearUploadedCache: () => ipcRenderer.invoke('clear-uploaded-cache'),
  getUserId: () => ipcRenderer.invoke('get-user-id'),
  validateReplayDir: (dir: string) => ipcRenderer.invoke('validate-replay-dir', dir),
  getVersion: () => ipcRenderer.invoke('get-version'),
} satisfies ElectronAPI);
