import type { Config } from 'drizzle-kit';
import 'dotenv/config';

export default {
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'teamledger',
    password: process.env.PGPASSWORD ?? '',
    database: process.env.PGDATABASE ?? 'teamledger',
    ssl: false,
  },
} satisfies Config;
