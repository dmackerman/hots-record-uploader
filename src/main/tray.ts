/**
 * System tray integration.
 * Shows status in the tray context menu, hides window to tray on close.
 */
import { app, Tray, Menu, nativeImage, BrowserWindow } from 'electron';
import * as path from 'path';
import type { WatcherState } from './watcher';

let tray: Tray | null = null;

const STATUS_LABELS: Record<WatcherState, string> = {
  idle: 'Waiting for HoTS...',
  gameRunning: 'Game in progress',
  cooldown: 'Game ended, waiting...',
  scanning: 'Scanning for new replays...',
  uploading: 'Uploading replays...',
};

export function createTray(mainWindow: BrowserWindow): Tray {
  // Use a simple 16x16 icon — in production, ship real icons in assets/
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('HoTS Replay Uploader');

  updateTrayMenu('idle');

  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow.show();
    }
  });

  // Hide to tray instead of closing
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  return tray;
}

export function updateTrayMenu(state: WatcherState, extra?: string): void {
  if (!tray) return;

  const statusText = extra || STATUS_LABELS[state];

  const contextMenu = Menu.buildFromTemplate([
    { label: statusText, enabled: false },
    { type: 'separator' },
    {
      label: 'Open',
      click: () => {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length > 0) {
          wins[0].show();
          wins[0].focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip(statusText);
}

// Extend app for isQuitting flag
declare module 'electron' {
  interface App {
    isQuitting: boolean;
  }
}
