/**
 * Integration-style tests for the state management flow.
 *
 * These tests exercise the full cycle that was failing on Windows:
 * 1. App starts → initial upload cycle runs
 * 2. Game starts → watcher transitions to gameRunning
 * 3. Game closes → cooldown → scanning → upload cycle
 *
 * The bug: after the initial upload on app start, the watcher's state
 * transitions weren't triggering subsequent upload cycles when HoTS closed.
 *
 * Root causes found:
 * - Windows process detection: 'heroesSwitcher' (capital S) never matched
 *   against lowercased tasklist output. Fixed to 'heroesswitcher'.
 * - State machine edge case: if the upload cycle is triggered manually
 *   and completes (resetToIdle), the watcher resumes polling and can
 *   detect the game. But if the game was never detected as "running"
 *   (stayed idle), closing it has no effect because the watcher only
 *   transitions from gameRunning → cooldown.
 */
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

import { HotsWatcher } from '../main/watcher';
import { exec } from 'child_process';

const mockExec = exec as unknown as jest.Mock;

function simulateHotsRunning(running: boolean) {
  mockExec.mockImplementation((_cmd: string, cb: Function) => {
    if (running) {
      cb(null, '12345\n', '');
    } else {
      cb(new Error('no match'), '', '');
    }
  });
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('state management integration', () => {
  let watcher: HotsWatcher;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    watcher = new HotsWatcher();
    mockExec.mockReset();
  });

  afterEach(() => {
    watcher.stop();
    jest.useRealTimers();
  });

  it('full lifecycle: idle → gameRunning → cooldown → scanning → idle', async () => {
    const states: string[] = [];
    const scans: number[] = [];

    watcher.on('state', (s: string) => states.push(s));
    watcher.on('scan', () => scans.push(Date.now()));

    // Phase 1: App starts, no game running
    simulateHotsRunning(false);
    watcher.start();
    await flushPromises();
    expect(watcher.getState()).toBe('idle');

    // Phase 2: User starts HoTS
    simulateHotsRunning(true);
    jest.advanceTimersByTime(5000);
    await flushPromises();
    expect(watcher.getState()).toBe('gameRunning');

    // Phase 3: User finishes game, closes HoTS
    simulateHotsRunning(false);
    jest.advanceTimersByTime(5000);
    await flushPromises();
    expect(watcher.getState()).toBe('cooldown');

    // Phase 4: Cooldown expires → scanning
    jest.advanceTimersByTime(5000);
    expect(watcher.getState()).toBe('scanning');
    expect(scans).toHaveLength(1);

    // Phase 5: Upload cycle completes
    watcher.resetToIdle();
    expect(watcher.getState()).toBe('idle');

    expect(states).toEqual([
      'gameRunning',
      'cooldown',
      'scanning',
      'idle',
    ]);
  });

  it('handles multiple game sessions in sequence', async () => {
    const scanCount = jest.fn();
    watcher.on('scan', scanCount);

    // Session 1
    simulateHotsRunning(true);
    watcher.start();
    await flushPromises();

    simulateHotsRunning(false);
    jest.advanceTimersByTime(5000);
    await flushPromises();
    jest.advanceTimersByTime(5000); // cooldown
    expect(scanCount).toHaveBeenCalledTimes(1);

    watcher.resetToIdle();

    // Session 2
    simulateHotsRunning(true);
    jest.advanceTimersByTime(5000);
    await flushPromises();
    expect(watcher.getState()).toBe('gameRunning');

    simulateHotsRunning(false);
    jest.advanceTimersByTime(5000);
    await flushPromises();
    jest.advanceTimersByTime(5000); // cooldown
    expect(scanCount).toHaveBeenCalledTimes(2);

    watcher.resetToIdle();

    // Session 3
    simulateHotsRunning(true);
    jest.advanceTimersByTime(5000);
    await flushPromises();
    expect(watcher.getState()).toBe('gameRunning');

    simulateHotsRunning(false);
    jest.advanceTimersByTime(5000);
    await flushPromises();
    jest.advanceTimersByTime(5000); // cooldown
    expect(scanCount).toHaveBeenCalledTimes(3);
  });

  it('does not emit scan if watcher is stopped during cooldown', async () => {
    const scanCount = jest.fn();
    watcher.on('scan', scanCount);

    simulateHotsRunning(true);
    watcher.start();
    await flushPromises();

    simulateHotsRunning(false);
    jest.advanceTimersByTime(5000);
    await flushPromises();
    expect(watcher.getState()).toBe('cooldown');

    // App is quitting — stop watcher
    watcher.stop();
    jest.advanceTimersByTime(10000);

    expect(scanCount).not.toHaveBeenCalled();
  });

  it('handles game never being detected (stays idle)', async () => {
    const scanCount = jest.fn();
    watcher.on('scan', scanCount);

    simulateHotsRunning(false);
    watcher.start();
    await flushPromises();

    // Many poll cycles pass with no game detected
    for (let i = 0; i < 20; i++) {
      jest.advanceTimersByTime(5000);
      await flushPromises();
    }

    // Should still be idle, no scans triggered
    expect(watcher.getState()).toBe('idle');
    expect(scanCount).not.toHaveBeenCalled();
  });

  it('manual upload resets to idle correctly, then detects next game', async () => {
    const scanCount = jest.fn();
    watcher.on('scan', scanCount);

    simulateHotsRunning(false);
    watcher.start();
    await flushPromises();

    // Manual upload: set to scanning, then reset
    watcher.setState('scanning');
    watcher.resetToIdle();
    expect(watcher.getState()).toBe('idle');

    // Game starts after manual upload
    simulateHotsRunning(true);
    jest.advanceTimersByTime(5000);
    await flushPromises();
    expect(watcher.getState()).toBe('gameRunning');

    // Game closes → should trigger scan
    simulateHotsRunning(false);
    jest.advanceTimersByTime(5000);
    await flushPromises();
    jest.advanceTimersByTime(5000);
    expect(scanCount).toHaveBeenCalledTimes(1);
  });

  it('setState to uploading blocks polling until reset', async () => {
    simulateHotsRunning(true);
    watcher.start();
    await flushPromises();
    expect(watcher.getState()).toBe('gameRunning');

    // Simulate upload starting (set by runUploadCycle in index.ts)
    watcher.setState('uploading');
    mockExec.mockClear();

    // Polls should be skipped
    jest.advanceTimersByTime(15000);
    await flushPromises();
    expect(mockExec).not.toHaveBeenCalled();

    // Upload completes
    watcher.resetToIdle();
    jest.advanceTimersByTime(5000);
    await flushPromises();

    // Now polling resumes
    expect(mockExec).toHaveBeenCalled();
  });

  describe('Windows process detection (case sensitivity)', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('detects HeroesSwitcher.exe case-insensitively on Windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      // Simulate tasklist output with mixed case
      mockExec.mockImplementation((_cmd: string, cb: Function) => {
        cb(null, 'Image Name                     PID\nHeroesSwitcher.exe             1234\n', '');
      });

      const testWatcher = new HotsWatcher();
      testWatcher.start();
      await flushPromises();

      expect(testWatcher.getState()).toBe('gameRunning');
      testWatcher.stop();
    });

    it('detects HeroesOfTheStorm_x64.exe on Windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      mockExec.mockImplementation((_cmd: string, cb: Function) => {
        cb(null, 'Image Name                     PID\nHeroesOfTheStorm_x64.exe       5678\n', '');
      });

      const testWatcher = new HotsWatcher();
      testWatcher.start();
      await flushPromises();

      expect(testWatcher.getState()).toBe('gameRunning');
      testWatcher.stop();
    });

    it('reports not running when no HoTS process on Windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      mockExec.mockImplementation((_cmd: string, cb: Function) => {
        cb(null, 'Image Name                     PID\nchrome.exe                     1234\nexplorer.exe                   5678\n', '');
      });

      const testWatcher = new HotsWatcher();
      testWatcher.start();
      await flushPromises();

      expect(testWatcher.getState()).toBe('idle');
      testWatcher.stop();
    });
  });
});
