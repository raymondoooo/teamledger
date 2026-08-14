import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

// The database is a single file inside the data directory, alongside
// data/receipts and data/backups. That is deliberate: it means the whole
// install is one directory a treasurer can copy, and the nightly backup sweep
// picks it up without being told about it separately.
//
// Resolved from process.cwd() for the same reason web-dist and migrations are —
// the Dockerfile's WORKDIR is /app, so this is /app/data in the container and
// server/data when running from a checkout.
export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const sqlite = new Database(path.join(DATA_DIR, 'teamledger.db'));

// Readers never block the writer and vice versa. Without this, a parent loading
// their balance while the sync scheduler is writing events gets SQLITE_BUSY.
sqlite.pragma('journal_mode = WAL');
// Wait out a competing write rather than failing instantly. SQLite allows one
// writer at a time; the iCal sync and a treasurer saving a payment can collide.
sqlite.pragma('busy_timeout = 5000');
// OFF by default in SQLite, and the schema is full of onDelete: 'cascade' that
// would silently do nothing without it — deleting a season would leave its
// events, expenses and payments behind as orphans. Enforced per connection, so
// it belongs here rather than in a migration.
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { schema };
