import 'dotenv/config';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import { trustProxy } from './config.js';
import { api } from './routes/api.js';
import { startBackupScheduler } from './services/backup.js';
import { startSyncScheduler } from './services/sync.js';

const app = express();

// Only believe X-Forwarded-For when explicitly told there is a proxy in front.
// Trusting it unconditionally lets anyone forge the header and hand themselves
// a fresh rate-limit bucket on every request. See config.ts.
app.set('trust proxy', trustProxy ? 1 : false);

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use('/api', api);

// The Vite bundle. The Dockerfile puts it at /app/web-dist, beside dist/.
const webDist = path.resolve(process.cwd(), 'web-dist');
app.use(express.static(webDist));

// Client-side routing: any non-/api path that isn't a real file is a React
// route, so hand back index.html and let the router sort it out.
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(webDist, 'index.html'));
});

const port = Number(process.env.PORT ?? 3212);
app.listen(port, '0.0.0.0', () => {
  console.log(`[teamledger] listening on ${port} (build ${process.env.BUILD_ID ?? 'unknown'})`);
  console.log(`[teamledger] trust proxy: ${trustProxy ? 'on' : 'off'}`);
  startSyncScheduler();
  startBackupScheduler();
});
