/**
 * Tests for ReplayUploader: upload flow, retries, cancellation, progress.
 */
jest.mock('electron', () => ({
  net: {
    request: jest.fn(),
  },
}));
jest.mock('fs');

import * as fs from 'fs';
import { ReplayUploader, UploadProgress, UploadResult } from '../main/uploader';
import { net } from 'electron';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockNetRequest = net.request as jest.MockedFunction<typeof net.request>;

// Helper: create a mock request/response chain
function createMockRequest(responseBody: object, statusCode = 200) {
  const mockResponse = {
    statusCode,
    on: jest.fn((event: string, handler: Function) => {
      if (event === 'data') {
        handler(Buffer.from(JSON.stringify(responseBody)));
      } else if (event === 'end') {
        handler();
      }
      return mockResponse;
    }),
  };

  const mockReq = {
    setHeader: jest.fn(),
    on: jest.fn((event: string, _handler: Function) => mockReq),
    write: jest.fn(),
    end: jest.fn(),
  };

  // When request is created, capture the response handler and call it
  mockNetRequest.mockImplementation(() => {
    // The response handler is attached via request.on('response', ...)
    const req = {
      setHeader: jest.fn(),
      on: jest.fn((event: string, handler: Function) => {
        if (event === 'response') {
          // Defer to next tick so the request can finish setup
          process.nextTick(() => handler(mockResponse));
        }
        return req;
      }),
      write: jest.fn(),
      end: jest.fn(),
    };
    return req as any;
  });
}

function createMockRequestError(error: Error) {
  mockNetRequest.mockImplementation(() => {
    const req = {
      setHeader: jest.fn(),
      on: jest.fn((event: string, handler: Function) => {
        if (event === 'error') {
          process.nextTick(() => handler(error));
        }
        return req;
      }),
      write: jest.fn(),
      end: jest.fn(),
    };
    return req as any;
  });
}

describe('ReplayUploader', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockFs.readFileSync.mockReturnValue(Buffer.from('fake-replay-data'));
  });

  describe('uploadReplays', () => {
    it('uploads files and returns correct counts', async () => {
      createMockRequest({ gameAdded: true, duplicate: false, userId: 'user123' });

      const uploader = new ReplayUploader('TestUser#1234');
      const result = await uploader.uploadReplays(['/replays/game1.StormReplay', '/replays/game2.StormReplay']);

      expect(result.gamesAdded).toBe(2);
      expect(result.duplicates).toBe(0);
      expect(result.errors).toBe(0);
      expect(result.userId).toBe('user123');
    });

    it('counts duplicates correctly', async () => {
      createMockRequest({ gameAdded: false, duplicate: true, userId: 'user123' });

      const uploader = new ReplayUploader('TestUser#1234');
      const result = await uploader.uploadReplays(['/replays/game1.StormReplay']);

      expect(result.gamesAdded).toBe(0);
      expect(result.duplicates).toBe(1);
      expect(result.errors).toBe(0);
    });

    it('emits progress events', async () => {
      createMockRequest({ gameAdded: true, duplicate: false, userId: 'user123' });

      const uploader = new ReplayUploader('TestUser#1234');
      const progressEvents: UploadProgress[] = [];
      uploader.on('progress', (p) => progressEvents.push(p));

      const resultPromise = uploader.uploadReplays(['/replays/game1.StormReplay', '/replays/game2.StormReplay']);
      const result = await resultPromise;

      expect(progressEvents.length).toBe(2);
      expect(progressEvents[0].current).toBe(1);
      expect(progressEvents[0].total).toBe(2);
      expect(progressEvents[1].current).toBe(2);
      expect(progressEvents[1].total).toBe(2);
    });

    it('emits done event with result', async () => {
      createMockRequest({ gameAdded: true, duplicate: false, userId: 'user123' });

      const uploader = new ReplayUploader('TestUser#1234');
      const doneSpy = jest.fn();
      uploader.on('done', doneSpy);

      const resultPromise = uploader.uploadReplays(['/replays/game1.StormReplay']);
      const result = await resultPromise;

      expect(doneSpy).toHaveBeenCalledTimes(1);
      expect(doneSpy).toHaveBeenCalledWith(expect.objectContaining({ gamesAdded: 1 }));
    });

    it('returns empty result for no files', async () => {
      const uploader = new ReplayUploader('TestUser#1234');
      const result = await uploader.uploadReplays([]);

      expect(result).toEqual({
        gamesAdded: 0,
        duplicates: 0,
        errors: 0,
        userId: null,
      });
    });
  });

  describe('cancellation', () => {
    it('stops processing remaining files when cancelled', async () => {
      let requestCount = 0;
      mockNetRequest.mockImplementation(() => {
        requestCount++;
        const mockResponse = {
          statusCode: 200,
          on: jest.fn((event: string, handler: Function) => {
            if (event === 'data') {
              handler(Buffer.from(JSON.stringify({ gameAdded: true, duplicate: false, userId: 'u1' })));
            } else if (event === 'end') {
              handler();
            }
            return mockResponse;
          }),
        };
        const req = {
          setHeader: jest.fn(),
          on: jest.fn((event: string, handler: Function) => {
            if (event === 'response') {
              process.nextTick(() => handler(mockResponse));
            }
            return req;
          }),
          write: jest.fn(),
          end: jest.fn(),
        };
        return req as any;
      });

      const uploader = new ReplayUploader('TestUser#1234');

      // Cancel after first progress event
      uploader.on('progress', () => {
        uploader.cancel();
      });

      const resultPromise = uploader.uploadReplays([
        '/replays/game1.StormReplay',
        '/replays/game2.StormReplay',
        '/replays/game3.StormReplay',
      ]);

      const result = await resultPromise;

      // Should have only processed the first file
      expect(result.gamesAdded).toBeLessThanOrEqual(1);
    });
  });

  describe('error handling', () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it('counts errors when upload fails after all retries', async () => {
      jest.useRealTimers(); // retries use setTimeout with backoff — use real timers
      createMockRequestError(new Error('Network error'));

      const uploader = new ReplayUploader('TestUser#1234');
      const result = await uploader.uploadReplays(['/replays/game1.StormReplay']);

      expect(result.errors).toBe(1);
      expect(result.gamesAdded).toBe(0);
    });

    it('handles server error responses', async () => {
      jest.useRealTimers(); // retries use setTimeout with backoff
      mockNetRequest.mockImplementation(() => {
        const mockResponse = {
          statusCode: 200,
          on: jest.fn((event: string, handler: Function) => {
            if (event === 'data') {
              handler(Buffer.from(JSON.stringify({ error: 'Server error' })));
            } else if (event === 'end') {
              handler();
            }
            return mockResponse;
          }),
        };
        const req = {
          setHeader: jest.fn(),
          on: jest.fn((event: string, handler: Function) => {
            if (event === 'response') {
              process.nextTick(() => handler(mockResponse));
            }
            return req;
          }),
          write: jest.fn(),
          end: jest.fn(),
        };
        return req as any;
      });

      const uploader = new ReplayUploader('TestUser#1234');
      const result = await uploader.uploadReplays(['/replays/game1.StormReplay']);

      // Server errors cause the retry loop to fail, resulting in an error count
      expect(result.errors).toBe(1);
    });

    it('handles invalid JSON responses', async () => {
      jest.useRealTimers(); // retries use setTimeout with backoff
      mockNetRequest.mockImplementation(() => {
        const mockResponse = {
          statusCode: 200,
          on: jest.fn((event: string, handler: Function) => {
            if (event === 'data') {
              handler(Buffer.from('not json'));
            } else if (event === 'end') {
              handler();
            }
            return mockResponse;
          }),
        };
        const req = {
          setHeader: jest.fn(),
          on: jest.fn((event: string, handler: Function) => {
            if (event === 'response') {
              process.nextTick(() => handler(mockResponse));
            }
            return req;
          }),
          write: jest.fn(),
          end: jest.fn(),
        };
        return req as any;
      });

      const uploader = new ReplayUploader('TestUser#1234');
      const result = await uploader.uploadReplays(['/replays/game1.StormReplay']);

      expect(result.errors).toBe(1);
    });
  });
});
