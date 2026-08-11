import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

// pg returns NUMERIC as a string and DATE as a JS Date in the server's local
// timezone. We store money as integers and dates as plain calendar dates, so
// the only override needed is DATE (OID 1082) — hand it back as the literal
// 'YYYY-MM-DD' string rather than letting it become a timezone-shifted Date.
pg.types.setTypeParser(1082, (value) => value);

export const pool = new pg.Pool({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'teamledger',
  password: process.env.PGPASSWORD ?? '',
  database: process.env.PGDATABASE ?? 'teamledger',
});

// node-postgres emits 'error' on idle clients when the server goes away — a
// database restart, a network blip, an idle timeout. An EventEmitter 'error'
// with no listener is a hard crash in Node, so without this the whole app exits
// the moment Postgres bounces. Restarting the database under a running app is a
// completely ordinary thing for a self-hoster to do.
//
// The pool recovers on its own: the next query opens a fresh connection. Log it
// and stay up; /api/health reports 503 in the meantime so an orchestrator can
// see the app is degraded rather than guessing from a port check.
pool.on('error', (err) => {
  console.error('[db] idle client error (pool will reconnect):', err.message);
});

export const db = drizzle(pool, { schema });
export { schema };
