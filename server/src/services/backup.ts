import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, sqlite } from '../db/index.js';

// A nightly snapshot of the database, taken by the app itself. This is the whole
// reason the storage engine moved: the old answer was `pg_dump` from a second
// container, which in practice meant nobody's team budget was backed up at all.
//
// VACUUM INTO, not better-sqlite3's .backup(). .backup() is asynchronous and
// returns a promise that settles later, so a snapshot started at boot can land
// *after* the migration it was meant to precede — which is exactly the backup
// you would want on the morning an upgrade went wrong. VACUUM INTO is
// synchronous and writes one consistent file with the WAL already folded in, so
// it is also safe to take while the app is serving.

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR = 3;

export function runBackup(): string | null {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, `teamledger-${stamp}.db`);
  try {
    sqlite.prepare('VACUUM INTO ?').run(dest);
    console.log(`[backup] wrote ${dest}`);
    prune();
    return dest;
  } catch (err) {
    // A failed backup must never take the app down with it — a treasurer losing
    // the ability to record a payment is worse than a missing snapshot, and the
    // next run is 24 hours away.
    console.error('[backup] failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// Timestamps are ISO-8601, so lexical order is chronological order.
function prune(): void {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('teamledger-') && f.endsWith('.db'))
    .sort();
  for (const stale of files.slice(0, Math.max(0, files.length - KEEP))) {
    fs.unlinkSync(path.join(BACKUP_DIR, stale));
  }
}

// Daily at 03:00 local time. Deliberately not on a fixed interval from boot: a
// machine that gets restarted every evening would otherwise only ever snapshot
// at the same busy hour, and one left running for months would drift.
export function startBackupScheduler(): NodeJS.Timeout | null {
  if (process.env.BACKUPS === 'off') {
    console.log('[backup] disabled');
    return null;
  }
  const next = new Date();
  next.setHours(HOUR, 0, 0, 0);
  if (next.getTime() <= Date.now()) next.setTime(next.getTime() + DAY_MS);

  const timer = setTimeout(() => {
    runBackup();
    setInterval(runBackup, DAY_MS).unref();
  }, next.getTime() - Date.now());
  timer.unref();

  console.log(`[backup] nightly at 0${HOUR}:00, keeping ${KEEP} (${BACKUP_DIR})`);
  return timer;
}
