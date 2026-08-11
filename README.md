# teamledger

Self-hosted treasury for a youth sports team. It replaces the spreadsheet most
team treasurers end up maintaining: what the season costs, what each player owes,
who has paid, what's actually in the team bank account, and what carries over
when the season ends.

The thing it does that a spreadsheet cannot: it reads your **TeamSnap calendar**
and prices it. Set "ref fee is $75 a game" and "Sam charges $200 a session", and
the ref-fee and training totals come from how many games and practices are
actually on the schedule — including when one gets cancelled.

Ships with an empty database. Your data stays on your machine.

## Quick start

Requires Docker and Docker Compose.

```sh
git clone https://github.com/raymondoooo/teamledger.git
cd teamledger
cp .env.example .env
# edit .env: set SESSION_SECRET, PGPASSWORD and POSTGRES_PASSWORD
docker compose up -d --build
```

Open <http://localhost:3112>. The first screen creates your treasurer account.
There is no second account and no signup — this is a single-admin app.

Generate a session secret with:

```sh
openssl rand -base64 32
```

The app refuses to start without one, rather than falling back to a default
signing key.

### Using a prebuilt image

Released versions are published to GHCR and Docker Hub for `amd64` and `arm64`.
Replace `build: .` under the `app` service in `docker-compose.yml` with:

```yaml
image: ghcr.io/raymondoooo/teamledger:latest
```

Pin as tightly as you like — `:0.7.0`, `:0.7`, `:0` and `:latest` all exist.

## Upgrading

```sh
git pull
docker compose up -d --build
```

Migrations run automatically on every start and are idempotent, so there is no
separate upgrade step. Nothing is destructive; new columns are added, existing
data is left alone.

## Data & backups

Two things to back up:

| What | Where |
|---|---|
| The database (everything) | `db/data/` |
| Receipt uploads | `data/receipts/` |

A logical dump is friendlier than copying the data directory:

```sh
docker compose exec db pg_dump -U teamledger teamledger > backup.sql
```

You can also export from inside the app at any time — CSVs of the roster,
payment ledger, budget and balances, plus the bank ledger. That's the format to
hand to next season's treasurer.

## Features

**Budget**
- Expense categories (training, ref fees, tournaments, jerseys, misc), offset by
  credits, fundraising and sponsors, divided across the roster.
- **Estimates**: say you expect 12 practices before the schedule exists and dues
  can be set in pre-season. The engine bills whichever is higher, your estimate
  or the number actually scheduled, so it never under-collects.
- **Tournaments** with name, dates and registration fee, including ones you have
  not booked yet.

**Money in**
- A payment ledger — every payment is a dated row with a method and a note, not a
  Yes/No checkbox, so the books survive a handover.
- Tick-box first and final instalments straight from the roster.
- **Per-player fundraising**: what a player raised themselves comes off their own
  bill, not the whole team's.
- Per-player dues overrides for scholarships, sibling discounts or late joiners.

**Money out**
- **Bank ledger** with a starting balance, running balance, and a reconcile tick
  for matching against your statement.
- **Venmo transfer tracking**: parents' payments land in *your* personal account
  first. Mark them transferred and it writes one deposit line for the batch.
- **Trainer payables**: what each trainer has earned for sessions that have
  already happened, minus what you have paid them. Future sessions never show as
  owed.
- Mark an expense or tournament fee paid and the withdrawal is written for you.

**Schedule**
- Subscribe to the TeamSnap iCal feed; games and practices import and drive the
  derived costs.
- **Repeating events are expanded**, so a weekly practice published as a single
  recurring entry becomes twelve billable sessions rather than one. Individually
  skipped weeks (`EXDATE`) and moved weeks (`RECURRENCE-ID`) are honoured.
- Events the feed stops publishing are cancelled so they stop costing — but only
  future ones, since a feed that drops past events as they age out must not erase
  costs the team actually incurred.
- Add events by hand, with a weekly repeat.
- A primary trainer is attached to new events automatically.

**Everything else**
- **Season rollover** — close a season and open the next with the same roster.
  Overpayments follow the player as a credit; leftover team funds arrive as a
  credit line.
- Exports: CSV (roster, ledger, budget, balances, bank ledger) and PDF (budget
  sheet, detailed budget report, per-player statement).
- Works on a phone, and installs to the home screen as a standalone app.

## Configuration

Everything lives in `.env`; see `.env.example` for the annotated list.

| Variable | Notes |
|---|---|
| `SESSION_SECRET` | Required. `openssl rand -base64 32`. |
| `APP_URL` | The URL you actually browse to. |
| `SECURE_COOKIES` | Default **off**. Turn on only when TLS is in front. Deliberately not tied to `NODE_ENV` — see below. |
| `TRUST_PROXY` | Default **off**. Turn on only when a proxy you control sets `X-Forwarded-For`. |
| `LOGIN_RATE_MAX` / `LOGIN_RATE_WINDOW_MS` | Failed logins allowed per window. Defaults: 10 per 15 minutes. |
| `NODE_ENV` | `production` in normal use. Does **not** affect cookie or proxy behaviour. |
| `TZ` | Your team's timezone, or the schedule drifts a day around midnight. |
| `ICAL_SYNC_INTERVAL_MINUTES` | Default 360. `0` disables the background sync. |
| `BUILD_ID` | Free-text label echoed by `/api/health`. |
| `PG*` / `POSTGRES_*` | Database credentials. The two sets must match. |

### Running behind a reverse proxy

Terminate TLS at your proxy, forward to port 3112, and set:

```
APP_URL=https://teamledger.example.com
SECURE_COOKIES=true
TRUST_PROXY=true
```

Both switches default to **off**, and neither is inferred from `NODE_ENV`. That
is deliberate:

- `SECURE_COOKIES` on without TLS gives you a cookie the browser accepts and then
  refuses to send back — you sign in, land on the login form again, and get no
  error explaining why.
- `TRUST_PROXY` on *without* a real proxy lets anyone forge `X-Forwarded-For` and
  hand themselves a fresh rate-limit bucket on every request, turning the login
  limiter into unlimited password guesses.

### Connecting TeamSnap

In TeamSnap: **Schedule → Subscribe / Export**, copy the calendar link, and paste
it into **Settings → TeamSnap calendar**. It polls every 6 hours by default and
there's a **Sync now** button on the Schedule page.

Event types are guessed from the title — "vs Rivals" is a game, "Practice" is a
practice. Correcting a type pins it, so later syncs will not change it back.

## Known limitations

- **Recurring events are expanded within the season window only.** A repeating
  practice becomes one row per occurrence, bounded by the season's start and end
  dates (or the season year if you have not set them), and capped at 400
  occurrences per series. A rule extending beyond that window is clipped.
- **No parent-facing view.** Parents don't log in; you send them a PDF statement.
- **One admin account.** No co-treasurer, no password reset.
- **`SESSION_SECRET` must be set**; the app will not start without it. Most
  self-hosted apps generate one on first boot instead. This one deliberately does
  not: the secret signs sessions for financial records, and a value quietly
  generated into a container is a value nobody backs up, so restoring a database
  onto a fresh container would silently invalidate every session with no
  explanation. Generating one is a single documented command.
- **No automatic pre-upgrade backup.** The database is a separate Postgres
  service, so the app cannot dump it from inside its own container. Migrations
  are forward-only and additive, and the app refuses to start if the database is
  newer than the image — but take a `pg_dump` before upgrading.

## Supporting this

If teamledger saves you an evening of spreadsheet wrangling, you can
[buy me a coffee](https://ko-fi.com/raymondoooo). Entirely optional — the app is
AGPL and always will be.

## Security

**Put this behind something.** There is no login rate limiting, no 2FA, and the
setup screen is claimable by whoever reaches an unconfigured instance first. It
is built to run on your LAN, behind a VPN, or behind an authenticating proxy
(Cloudflare Access, Authelia, Tailscale).

See [SECURITY.md](SECURITY.md) for the full threat model and how to report a
vulnerability privately.

## Development

```sh
npm install
npm run dev:server   # API on :3000
npm run dev:web      # Vite on :5173, proxying /api
npm test             # money and calendar-classification tests
```

You need a Postgres to point at — `docker compose up -d db` is enough, with
`PGHOST=localhost` in your `.env`.

After changing `server/src/db/schema.ts`, run `npm run db:generate` and commit the
generated migration.

See [CLAUDE.md](CLAUDE.md) for the invariants worth knowing before changing the
money code.

## Notes on the money

All amounts are stored as integer cents. Splitting a bill across a roster rarely
divides evenly, so the per-player shares are computed to sum **exactly** to the
team total — the leftover pennies get distributed one at a time rather than
rounding every player up. The single figure quoted on the dashboard is rounded
up, which is why it can be a cent above the exact share.

For a 15-player team on $4,075.00: ten players are billed $271.67 and five
$271.66, summing to exactly $4,075.00. A spreadsheet showing $271.67 for everyone
would collect $4,075.05.

## Licence

GNU AGPL-3.0 — see [LICENSE](LICENSE).

In short: you can run, modify and share this freely, but if you run a modified
version as a service for other people, you have to make your changes available
too.

Copyright (C) 2026 TenantSentinel LLC.
