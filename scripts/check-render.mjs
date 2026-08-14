// Proves the app actually renders in a browser, rather than merely returning
// HTML with a 200.
//
// This exists because of a near miss. A dependency bump left two copies of
// React in the tree, React threw "Cannot read properties of null (reading
// 'useRef')" on mount, and every screen was blank white. The whole suite stayed
// green: the server was healthy, /api answered, the money math was right, and
// the catch-all dutifully served index.html for every route. Nothing that only
// speaks HTTP can tell a working app from an empty <div id="root">.
//
//   node scripts/check-render.mjs http://localhost:3212
//
// Needs playwright + a chromium; CI installs both. Run against the setup screen
// of a fresh instance, which is the one page reachable with no session.

import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3212';
const MIN_RENDERED_BYTES = 100;

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();

const problems = [];

// An uncaught exception is always a fault — that is what a broken render looks
// like from the outside.
page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`));

// Console errors need one exception. Loading the app signed-out is the normal
// state on this page: /api/auth/me answers 401, the browser logs a failed
// resource, and the app correctly shows the login form. Treating that as a
// failure would mean this check only ever passed against a pristine instance
// and broke the moment anything created an admin.
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  if (/Failed to load resource/i.test(text) && /\b(401|403)\b/.test(text)) return;
  problems.push(`console: ${text}`);
});
page.on('requestfailed', (r) => problems.push(`failed request: ${r.url()}`));

let failed = false;
try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForTimeout(1500);

  const root = await page.evaluate(() => {
    const el = document.getElementById('root');
    return { found: !!el, len: el ? el.innerHTML.length : -1, text: (el?.innerText ?? '').trim() };
  });

  if (!root.found) {
    console.error('FAIL: no #root element — the app shell was not served');
    failed = true;
  } else if (root.len < MIN_RENDERED_BYTES) {
    console.error(`FAIL: #root is empty (${root.len} bytes) — the app mounted nothing.`);
    console.error('This is a white screen. Users would see a blank page.');
    failed = true;
  } else {
    console.log(`rendered ${root.len} bytes: ${root.text.replace(/\s+/g, ' ').slice(0, 80)}`);
  }

  if (problems.length) {
    console.error('FAIL: the page reported errors:');
    for (const p of problems.slice(0, 10)) console.error(`  ${p}`);
    failed = true;
  }
} catch (err) {
  console.error(`FAIL: could not load ${url}: ${err.message}`);
  failed = true;
} finally {
  await browser.close();
}

if (failed) process.exit(1);
console.log('the app renders with no console or page errors');
