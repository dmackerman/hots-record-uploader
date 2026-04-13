/**
 * Process detection for Heroes of the Storm.
 *
 * State machine: idle → gameRunning → cooldown → scanning
 * Emits state changes so the tray/renderer can react.
 */
import { exec } from 'child_process';
import { EventEmitter } from 'events';

export type WatcherState = 'idle' | 'gameRunning' | 'cooldown' | 'scanning' | 'uploading';

const POLL_INTERVAL = 5_000; // 5 seconds
const COOLDOWN_MS = 5_000; // 5 seconds after HoTS closes

export class HotsWatcher extends EventEmitter {
  private state: WatcherState = 'idle';
  private timer: ReturnType<typeof setInterval> | null = null;
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;

  getState(): WatcherState {
    return this.state;
  }

  setState(next: WatcherState): void {
    if (this.state !== next) {
      this.state = next;
      this.emit('state', next);
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL);
    this.poll();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }
  }

  private async poll(): Promise<void> {
    // Don't poll during cooldown, scanning, or uploading
    if (this.state === 'cooldown' || this.state === 'scanning' || this.state === 'uploading') {
      return;
    }

    const running = await isHotsRunning();

    if (this.state === 'idle' && running) {
      this.setState('gameRunning');
    } else if (this.state === 'gameRunning' && !running) {
      this.setState('cooldown');
      this.cooldownTimer = setTimeout(() => {
        this.cooldownTimer = null;
        this.setState('scanning');
        this.emit('scan');
      }, COOLDOWN_MS);
    }
  }

  /** Reset to idle after upload cycle completes. */
  resetToIdle(): void {
    this.setState('idle');
  }
}

function isHotsRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec('tasklist /NH', (err, stdout) => {
        if (err) {
          resolve(false);
          return;
        }
        const lower = stdout.toLowerCase();
        resolve(
          lower.includes('heroesofthestorm') ||
            lower.includes('heroes of the storm') ||
            lower.includes('heroesswitcher')
        );
      });
    } else if (process.platform === 'darwin') {
      // pgrep -f matches against the full command line, not just the process name
      exec('pgrep -if "heroes.*(of.*the.*storm|switcher)"', (err, stdout) => {
        resolve(!err && stdout.trim().length > 0);
      });
    } else {
      // Linux
      exec('pgrep -if "heroes.*(of.*the.*storm|switcher)"', (err, stdout) => {
        resolve(!err && stdout.trim().length > 0);
      });
    }
  });
}
