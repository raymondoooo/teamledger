import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db, sqlite } from './index.js';

// Runs as the first half of the container's CMD. Drizzle keeps its own record of
// applied migrations, so this is a no-op on an already-migrated database and a
// full install on an empty one — which is what makes `docker compose up` the
// only step someone cloning this repo has to perform.
//
// migrationsFolder is resolved from process.cwd(); the Dockerfile copies
// server/migrations to /app/migrations to match.
const folder = process.env.MIGRATIONS_DIR ?? './migrations';

// The number of migrations this binary ships with. Read from the journal that
// travels with the image rather than hardcoded, so it cannot drift from what is
// actually on disk.
function binarySchemaVersion(): number {
  const journal = JSON.parse(
    readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: unknown[] };
  return journal.entries.length;
}

// Stored separately from Drizzle's own bookkeeping because we need to read it
// *before* deciding whether it is safe to run the migrator at all.
function storedSchemaVersion(): number {
  db.run(sql`
    create table if not exists app_schema_version (
      id integer primary key default 1,
      version integer not null,
      updated_at integer not null default (unixepoch()),
      constraint app_schema_version_single_row check (id = 1)
    )
  `);
  // db.get() hands back the row itself, or undefined for no rows — not the
  // { rows: [...] } envelope node-postgres used to return.
  const row = db.get<{ version: number }>(
    sql`select version from app_schema_version where id = 1`,
  );
  return row ? Number(row.version) : 0;
}

function stampSchemaVersion(version: number): void {
  db.run(sql`
    insert into app_schema_version (id, version, updated_at)
    values (1, ${version}, unixepoch())
    on conflict (id) do update set version = excluded.version, updated_at = unixepoch()
  `);
}

try {
  const binary = binarySchemaVersion();
  const stored = storedSchemaVersion();

  if (stored > binary) {
    // The user has rolled back to an older image. Running would let this binary
    // write into a schema it does not understand — silently corrupting data that
    // a newer version created. Refusing is dramatically better than continuing.
    console.error(
      '\n[migrate] REFUSING TO START.\n' +
        `[migrate] The database is at schema version ${stored}, but this image only understands ${binary}.\n` +
        '[migrate] You are running an older teamledger against a newer database.\n' +
        '[migrate] Start the newer image again, or restore a backup taken before the upgrade.\n',
    );
    process.exit(1);
  }

  // A non-empty database about to be migrated is the moment worth warning about.
  if (stored > 0 && binary > stored) {
    console.log(
      `[migrate] upgrading schema ${stored} -> ${binary}. ` +
        'If you have not backed up recently: stop the container and copy your data/ folder.',
    );
  }

  migrate(db, { migrationsFolder: folder });
  stampSchemaVersion(binary);
  console.log(`[migrate] schema up to date (version ${binary})`);
} catch (err) {
  console.error('[migrate] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  sqlite.close();
}
