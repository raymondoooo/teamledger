#!/usr/bin/env node
// Step 2 of moving an existing teamledger off Postgres: load the JSON produced
// by scripts/export-postgres.sh into the SQLite database.
//
//   docker compose exec app node scripts/import-postgres.cjs /app/data/pg-export.json
//
// Runs inside the app container so it can use the better-sqlite3 that is
// already there — no checkout, no npm install, no toolchain on the host.
//
// Refuses to touch a database that already has data in it. Re-running after a
// failure means starting from an empty one, which is the only way to be sure
// you do not end up with half an import silently merged into a fresh install.

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

// Insertion order is foreign-key order: a row is only written once everything
// it points at exists. Getting this wrong surfaces as FOREIGN KEY constraint
// failed, which is the correct outcome — better a loud stop than an orphan.
//
// `ts` columns are Postgres timestamps arriving as ISO strings and stored as
// unix seconds; `bool` columns arrive as JSON true/false and store as 0/1.
// Everything else — every money column included — is copied through untouched.
const TABLES = [
  { name: 'admin_users', ts: ['created_at'] },
  { name: 'teams', ts: ['created_at'] },
  { name: 'players', ts: ['created_at'], bool: ['active'] },
  { name: 'seasons', ts: ['closed_at', 'created_at'] },
  { name: 'trainers', ts: ['created_at'], bool: ['is_primary', 'active'] },
  { name: 'season_players', ts: ['created_at'] },
  { name: 'ical_feeds', ts: ['last_synced_at', 'created_at'] },
  {
    name: 'events',
    ts: ['starts_at', 'ends_at', 'created_at'],
    bool: ['type_confirmed', 'cancelled'],
  },
  { name: 'cost_rules', ts: ['created_at'], bool: ['active'] },
  { name: 'tournaments', ts: ['created_at'], bool: ['estimated'] },
  { name: 'event_charges', bool: ['overridden'] },
  { name: 'bank_accounts', ts: ['created_at'] },
  { name: 'bank_transactions', ts: ['created_at'], bool: ['reconciled'] },
  { name: 'expenses', ts: ['created_at'] },
  { name: 'credits', ts: ['created_at'] },
  { name: 'player_credits', ts: ['created_at'] },
  { name: 'payments', ts: ['created_at'] },
  { name: 'trainer_payments', ts: ['created_at'] },
];

function toEpochSeconds(value, table, column) {
  if (value === null || value === undefined) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error(`${table}.${column}: cannot read ${JSON.stringify(value)} as a timestamp`);
  }
  return Math.floor(ms / 1000);
}

function main() {
  const [, , jsonPath, dbPathArg] = process.argv;
  if (!jsonPath) {
    console.error('usage: node scripts/import-postgres.cjs <pg-export.json> [teamledger.db]');
    process.exit(1);
  }
  const dbPath =
    dbPathArg ?? path.join(process.env.DATA_DIR ?? '/app/data', 'teamledger.db');

  const dump = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const missing = TABLES.filter((t) => !dump[t.name]);
  if (missing.length) {
    throw new Error(`export is missing tables: ${missing.map((t) => t.name).join(', ')}`);
  }

  // The schema has to exist already — the app creates it on first boot — and it
  // has to be empty, so this can never half-merge into a live install.
  for (const { name } of TABLES) {
    const { c } = db.prepare(`select count(*) c from ${name}`).get();
    if (c > 0) {
      throw new Error(
        `${name} already has ${c} row(s). Import only runs into an empty database: ` +
          'stop the app, delete data/teamledger.db, start it once to recreate the schema, then retry.',
      );
    }
  }

  let total = 0;
  const run = db.transaction(() => {
    for (const spec of TABLES) {
      const rows = dump[spec.name];
      if (!rows.length) continue;
      const tsCols = new Set(spec.ts ?? []);
      const boolCols = new Set(spec.bool ?? []);

      // Column list comes from the destination table, so a column that exists
      // in the old database but not the new one is dropped deliberately rather
      // than blowing up mid-insert.
      const columns = db
        .prepare(`pragma table_info(${spec.name})`)
        .all()
        .map((c) => c.name)
        .filter((c) => c in rows[0]);

      const insert = db.prepare(
        `insert into ${spec.name} (${columns.map((c) => `"${c}"`).join(', ')})
         values (${columns.map(() => '?').join(', ')})`,
      );

      for (const row of rows) {
        insert.run(
          columns.map((c) => {
            const v = row[c];
            if (tsCols.has(c)) return toEpochSeconds(v, spec.name, c);
            if (boolCols.has(c)) return v === null || v === undefined ? null : v ? 1 : 0;
            return v === undefined ? null : v;
          }),
        );
      }
      console.log(`  ${spec.name}: ${rows.length}`);
      total += rows.length;
    }
  });

  run();

  const bad = db.pragma('foreign_key_check');
  if (bad.length) throw new Error(`foreign key check failed: ${JSON.stringify(bad.slice(0, 5))}`);

  console.log(`\nimported ${total} rows into ${dbPath}`);
  console.log('Check the season budget totals against the old app before deleting anything.');
  db.close();
}

try {
  main();
} catch (err) {
  console.error(`\n[import] failed: ${err.message}`);
  process.exit(1);
}
