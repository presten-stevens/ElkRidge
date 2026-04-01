import { mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DATA_DIR = join(process.cwd(), 'data');
const SYNC_FILE = join(DATA_DIR, 'last-synced.json');

let dirReady = false;
let writeChain = Promise.resolve();

async function ensureDir(): Promise<void> {
  if (!dirReady) {
    await mkdir(DATA_DIR, { recursive: true });
    dirReady = true;
  }
}

export async function writeSyncState(lastSyncedAt: string): Promise<void> {
  // Serialize writes so concurrent events don't race on the tmp file
  writeChain = writeChain.then(async () => {
    await ensureDir();
    const tmpPath = join(DATA_DIR, `.last-synced-${Date.now()}.tmp`);
    await writeFile(tmpPath, JSON.stringify({ lastSyncedAt }), 'utf-8');
    await rename(tmpPath, SYNC_FILE);
  });
  await writeChain;
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
