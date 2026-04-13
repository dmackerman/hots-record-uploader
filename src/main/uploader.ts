/**
 * Upload logic: sends individual .StormReplay files to the API.
 * Emits progress events for the renderer.
 */
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { net } from 'electron';

const API_BASE = 'https://hots-record.dmackerman.workers.dev';
const APP_KEY = 'hots-desktop-uploader-v1';
const MAX_RETRIES = 3;

export interface UploadProgress {
  current: number;
  total: number;
  fileName: string;
  gamesAdded: number;
  duplicates: number;
  errors: number;
}

export interface UploadResult {
  gamesAdded: number;
  duplicates: number;
  errors: number;
  userId: string | null;
  errorMessage?: string;
}

export class ReplayUploader extends EventEmitter {
  private battletag: string;

  constructor(battletag: string) {
    super();
    this.battletag = battletag;
  }

  async uploadReplays(replayPaths: string[]): Promise<UploadResult> {
    const result: UploadResult = {
      gamesAdded: 0,
      duplicates: 0,
      errors: 0,
      userId: null,
    };

    for (let i = 0; i < replayPaths.length; i++) {
      const filePath = replayPaths[i];
      const fileName = path.basename(filePath);

      this.emit('progress', {
        current: i + 1,
        total: replayPaths.length,
        fileName,
        gamesAdded: result.gamesAdded,
        duplicates: result.duplicates,
        errors: result.errors,
      } satisfies UploadProgress);

      const res = await this.uploadOne(filePath);

      if (res === null) {
        result.errors++;
      } else if (res.duplicate) {
        result.duplicates++;
        if (res.userId) result.userId = res.userId;
      } else {
        result.gamesAdded++;
        if (res.userId) result.userId = res.userId;
      }
    }

    this.emit('done', result);
    return result;
  }

  private async uploadOne(
    filePath: string
  ): Promise<{ gameAdded: boolean; duplicate: boolean; userId: string } | null> {
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await this.postReplay(fileBuffer, fileName);
        return result;
      } catch (err) {
        console.error(`Upload attempt ${attempt + 1} failed for ${fileName}:`, err);
        if (attempt < MAX_RETRIES - 1) {
          // Exponential backoff: 1s, 2s, 4s
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }
    return null;
  }

  private postReplay(
    fileBuffer: Buffer,
    fileName: string
  ): Promise<{ gameAdded: boolean; duplicate: boolean; userId: string }> {
    return new Promise((resolve, reject) => {
      // Build multipart form data manually for Electron's net module
      const boundary = `----ElectronBoundary${Date.now()}`;
      const parts: Buffer[] = [];

      // File part
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
        )
      );
      parts.push(fileBuffer);
      parts.push(Buffer.from('\r\n'));

      // Battletag part
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="battletag"\r\n\r\n${this.battletag}\r\n`
        )
      );

      // Closing boundary
      parts.push(Buffer.from(`--${boundary}--\r\n`));

      const body = Buffer.concat(parts);

      const request = net.request({
        method: 'POST',
        url: `${API_BASE}/api/upload/replay`,
      });

      request.setHeader('X-App-Key', APP_KEY);
      request.setHeader('Content-Type', `multipart/form-data; boundary=${boundary}`);

      let responseData = '';

      request.on('response', (response) => {
        response.on('data', (chunk: Buffer) => {
          responseData += chunk.toString();
        });
        response.on('end', () => {
          try {
            const json = JSON.parse(responseData);
            if (json.error) {
              reject(new Error(json.error));
            } else {
              resolve({
                gameAdded: json.gameAdded ?? false,
                duplicate: json.duplicate ?? false,
                userId: json.userId ?? '',
              });
            }
          } catch {
            reject(new Error(`Invalid response: ${responseData.slice(0, 200)}`));
          }
        });
      });

      request.on('error', reject);
      request.write(body);
      request.end();
    });
  }
}
