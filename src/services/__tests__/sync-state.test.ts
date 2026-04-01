import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readSyncState, writeSyncState, _resetForTest } from '../sync-state.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

vi.mock('node:fs/promises');

describe('SyncState', () => {
  const mockedFs = vi.mocked(fs);
  const DATA_DIR = path.join(process.cwd(), 'data');
  const SYNC_FILE = path.join(DATA_DIR, 'last-synced.json');

  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('writeSyncState', () => {
    it('writes JSON with lastSyncedAt field to data/last-synced.json', async () => {
      mockedFs.mkdir.mockResolvedValue(undefined);
      mockedFs.writeFile.mockResolvedValue(undefined);
      mockedFs.rename.mockResolvedValue(undefined);

      await writeSyncState('2026-03-30T00:00:00.000Z');

      expect(mockedFs.mkdir).toHaveBeenCalledWith(DATA_DIR, { recursive: true });
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.last-synced-'),
        JSON.stringify({ lastSyncedAt: '2026-03-30T00:00:00.000Z' }),
        'utf-8',
      );
      expect(mockedFs.rename).toHaveBeenCalledWith(
        expect.stringContaining('.last-synced-'),
        SYNC_FILE,
      );
    });

    it('creates data/ directory if it does not exist', async () => {
      mockedFs.mkdir.mockResolvedValue(undefined);
      mockedFs.writeFile.mockResolvedValue(undefined);
      mockedFs.rename.mockResolvedValue(undefined);

      await writeSyncState('2026-03-30T00:00:00.000Z');

      expect(mockedFs.mkdir).toHaveBeenCalledWith(DATA_DIR, { recursive: true });
    });

    it('uses atomic temp-file-then-rename', async () => {
      mockedFs.mkdir.mockResolvedValue(undefined);
      mockedFs.writeFile.mockResolvedValue(undefined);
      mockedFs.rename.mockResolvedValue(undefined);

      await writeSyncState('2026-03-30T00:00:00.000Z');

      const writeCall = mockedFs.writeFile.mock.calls[0]!;
      const tmpPath = writeCall[0] as string;
      expect(tmpPath).toMatch(/data[/\\]\.last-synced-\d+\.tmp$/);

      const renameCall = mockedFs.rename.mock.calls[0]!;
      expect(renameCall[0]).toBe(tmpPath);
      expect(renameCall[1]).toBe(SYNC_FILE);
    });
  });

  describe('readSyncState', () => {
    it('returns lastSyncedAt from file', async () => {
      mockedFs.readFile.mockResolvedValue(
        JSON.stringify({ lastSyncedAt: '2026-03-30T00:00:00.000Z' }),
      );

      const result = await readSyncState();
      expect(result).toBe('2026-03-30T00:00:00.000Z');
    });

    it('returns null if file does not exist', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      mockedFs.readFile.mockRejectedValue(err);

      const result = await readSyncState();
      expect(result).toBeNull();
    });
  });
});
