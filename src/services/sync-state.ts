import { mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DATA_DIR = join(process.cwd(), 'data');
const SYNC_FILE = join(DATA_DIR, 'last-synced.json');

export async function writeSyncState(lastSyncedAt: string): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tmpPath = join(DATA_DIR, `.last-synced-${Date.now()}.tmp`);
  await writeFile(tmpPath, JSON.stringify({ lastSyncedAt }), 'utf-8');
  await rename(tmpPath, SYNC_FILE);
}

export async function readSyncState(): Promise<string | null> {
  try {
    const raw = await readFile(SYNC_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as { lastSyncedAt: string };
    return parsed.lastSyncedAt;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}
