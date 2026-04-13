/**
 * Tests for HotsWatcher state machine.
 *
 * State diagram: idle → gameRunning → cooldown → scanning → (uploading → idle)
 *
 * Edge cases tested:
 * - Game detected while idle → transitions to gameRunning
 * - Game closed → cooldown → scanning → emits 'scan'
 * - Rapid game close/reopen during cooldown
 * - No double-transitions when state is already correct
 * - Poll is skipped during cooldown, scanning, uploading
 * - resetToIdle works from any state
 * - stop() cleans up timers
 */

// We need to test the watcher without actually spawning processes.
// Mock child_process.exec to control isHotsRunning().
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

import { HotsWatcher } from '../main/watcher';
import { exec } from 'child_process';

const mockExec = exec as unknown as jest.Mock;

// Helper: simulate process detection result.
// On macOS (default test env), isHotsRunning uses pgrep.
function simulateHotsRunning(running: boolean) {
  mockExec.mockImplementation((_cmd: string, cb: Function) => {
    if (running) {
      cb(null, '12345\n', ''); // pgrep returns PID
    } else {
      cb(new Error('no match'), '', ''); // pgrep exits with error when no match
    }
  });
}

describe('HotsWatcher', () => {
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

  describe('initial state', () => {
    it('starts in idle state', () => {
      expect(watcher.getState()).toBe('idle');
    });
  });

  describe('state transitions', () => {
    it('idle → gameRunning when HoTS is detected', async () => {
      simulateHotsRunning(true);
      const stateChanges: string[] = [];
      watcher.on('state', (s) => stateChanges.push(s));

      watcher.start();
      // Allow the poll's async callback to resolve
      await flushPromises();

      expect(watcher.getState()).toBe('gameRunning');
      expect(stateChanges).toEqual(['gameRunning']);
    });

    it('gameRunning → cooldown when HoTS closes', async () => {
      // Start with game running
      simulateHotsRunning(true);
      watcher.start();
      await flushPromises();
      expect(watcher.getState()).toBe('gameRunning');

      // Game closes
      simulateHotsRunning(false);
      jest.advanceTimersByTime(5000); // next poll
      await flushPromises();

      expect(watcher.getState()).toBe('cooldown');
    });

    it('cooldown → scanning after cooldown period', async () => {
      // Get to cooldown state
      simulateHotsRunning(true);
      watcher.start();
      await flushPromises();
      simulateHotsRunning(false);
      jest.advanceTimersByTime(5000);
      await flushPromises();
      expect(watcher.getState()).toBe('cooldown');

      const scanSpy = jest.fn();
      watcher.on('scan', scanSpy);

      // Advance past cooldown (5s)
      jest.advanceTimersByTime(5000);

      expect(watcher.getState()).toBe('scanning');
      expect(scanSpy).toHaveBeenCalledTimes(1);
    });

    it('emits scan event exactly once per game session', async () => {
      const scanSpy = jest.fn();
      watcher.on('scan', scanSpy);

      // Full cycle: idle → gameRunning → cooldown → scanning
      simulateHotsRunning(true);
      watcher.start();
      await flushPromises();

      simulateHotsRunning(false);
      jest.advanceTimersByTime(5000);
      await flushPromises();

      jest.advanceTimersByTime(5000); // cooldown expires

      expect(scanSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('poll skipping', () => {
    it('skips poll during cooldown state', async () => {
      simulateHotsRunning(true);
      watcher.start();
      await flushPromises();

      simulateHotsRunning(false);
      jest.advanceTimersByTime(5000);
      await flushPromises();
      expect(watcher.getState()).toBe('cooldown');

      // Reset mock to track new calls
      mockExec.mockClear();

      // Advance one poll interval — exec should NOT be called during cooldown
      jest.advanceTimersByTime(5000);
      await flushPromises();

      expect(mockExec).not.toHaveBeenCalled();
    });

    it('skips poll during uploading state', async () => {
      watcher.setState('uploading');
      simulateHotsRunning(true);
      watcher.start();

      mockExec.mockClear();
      jest.advanceTimersByTime(5000);
      await flushPromises();

      // Exec was called once on start() but should skip due to uploading
      // Actually start() calls poll() immediately, but it returns early due to state
      expect(watcher.getState()).toBe('uploading');
    });

    it('skips poll during scanning state', async () => {
      watcher.setState('scanning');
      mockExec.mockClear();
      watcher.start();
      await flushPromises();

      expect(mockExec).not.toHaveBeenCalled();
    });
  });

  describe('resetToIdle', () => {
    it('resets from scanning to idle', () => {
      watcher.setState('scanning');
      watcher.resetToIdle();
      expect(watcher.getState()).toBe('idle');
    });

    it('resets from uploading to idle', () => {
      watcher.setState('uploading');
      watcher.resetToIdle();
      expect(watcher.getState()).toBe('idle');
    });

    it('after reset, next poll can detect game again', async () => {
      // Full cycle
      simulateHotsRunning(true);
      watcher.start();
      await flushPromises();
      expect(watcher.getState()).toBe('gameRunning');

      simulateHotsRunning(false);
      jest.advanceTimersByTime(5000);
      await flushPromises();
      jest.advanceTimersByTime(5000); // cooldown expires
      expect(watcher.getState()).toBe('scanning');

      // Simulate upload completing
      watcher.resetToIdle();
      expect(watcher.getState()).toBe('idle');

      // New game starts
      simulateHotsRunning(true);
      jest.advanceTimersByTime(5000);
      await flushPromises();
      expect(watcher.getState()).toBe('gameRunning');
    });
  });

  describe('no duplicate state events', () => {
    it('does not emit state if already in that state', () => {
      const stateChanges: string[] = [];
      watcher.on('state', (s) => stateChanges.push(s));

      watcher.setState('idle'); // already idle — should not emit
      expect(stateChanges).toEqual([]);

      watcher.setState('gameRunning');
      watcher.setState('gameRunning'); // duplicate — should not emit
      expect(stateChanges).toEqual(['gameRunning']);
    });
  });

  describe('stop()', () => {
    it('clears poll timer', async () => {
      simulateHotsRunning(true);
      watcher.start();
      await flushPromises();

      watcher.stop();
      mockExec.mockClear();

      jest.advanceTimersByTime(10000);
      await flushPromises();

      expect(mockExec).not.toHaveBeenCalled();
    });

    it('clears cooldown timer', async () => {
      // Get to cooldown
      simulateHotsRunning(true);
      watcher.start();
      await flushPromises();
      simulateHotsRunning(false);
      jest.advanceTimersByTime(5000);
      await flushPromises();
      expect(watcher.getState()).toBe('cooldown');

      const scanSpy = jest.fn();
      watcher.on('scan', scanSpy);

      // Stop before cooldown expires
      watcher.stop();
      jest.advanceTimersByTime(10000);

      // Cooldown timer should have been cleared — no scan event
      expect(scanSpy).not.toHaveBeenCalled();
      // State stays cooldown because stop() doesn't reset state
      expect(watcher.getState()).toBe('cooldown');
    });

    it('calling start() after stop() resumes polling', async () => {
      watcher.start();
      watcher.stop();
      watcher.setState('idle'); // manual reset

      simulateHotsRunning(true);
      watcher.start();
      await flushPromises();

      expect(watcher.getState()).toBe('gameRunning');
    });
  });

  describe('start() idempotency', () => {
    it('calling start() twice does not create duplicate timers', async () => {
      simulateHotsRunning(false);
      watcher.start();
      watcher.start(); // second call should be a no-op
      await flushPromises();

      // Only one poll should have been called (from the first start)
      // Subsequent polls happen on interval, not duplicated
      const callCount = mockExec.mock.calls.length;
      expect(callCount).toBe(1); // Only the immediate poll from first start()
    });
  });

  describe('edge case: game restarts during cooldown', () => {
    it('cooldown timer still fires even if game restarts (known limitation)', async () => {
      // This test documents current behavior: if the game reopens during cooldown,
      // the cooldown timer still fires and transitions to scanning.
      // The poll is skipped during cooldown, so the game restart is not detected
      // until after the cooldown → scanning → resetToIdle cycle.
      simulateHotsRunning(true);
      watcher.start();
      await flushPromises();

      simulateHotsRunning(false);
      jest.advanceTimersByTime(5000);
      await flushPromises();
      expect(watcher.getState()).toBe('cooldown');

      // Game relaunches — but poll is skipped during cooldown
      simulateHotsRunning(true);
      jest.advanceTimersByTime(5000); // cooldown expires

      // Transitions to scanning even though game is running
      expect(watcher.getState()).toBe('scanning');
    });
  });
});

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
