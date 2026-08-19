# teamledger

Self-hosted treasury for a youth sports team. It replaces the spreadsheet most
team treasurers end up maintaining: what the season costs, what each player
owes, who has paid, what is actually in the team bank account, and what carries
over when the season ends.

The thing it does that a spreadsheet cannot: it reads your **schedule** and
prices it. Point it at any iCal feed — TeamSnap, SportsEngine, Spond, a club's
ICS export, even a plain Google Calendar. Set "ref fee is $75 a game" and "Sam
charges $200 a session", and the ref-fee and training totals come from how many
games and practices are actually on the schedule — including when one gets
cancelled.

## Quick start

```yaml
name: teamledger

services:
  app:
    image: raymondoooo/teamledger:latest
    container_name: teamledger
    restart: unless-stopped
    ports:
      - "3212:3212"
    volumes:
      - ./data:/app/data
    environment:
      TZ: America/New_York
```

```sh
docker compose up -d
```

Open <http://localhost:3212> and pick a treasurer email and password. That is the
whole install — no `.env`, no database password to invent, no build step. The
session secret is generated on first boot.

Whoever opens that setup screen first claims the instance, so do it before
putting teamledger anywhere the public can reach.

Dues can be collected in as many instalments as you like — two, or four across
the year — with each player's share worked out to the cent. The Budget page also
drafts the post for your team's message board, with those dates and amounts and
your Venmo handle already in it.

## Tags

`latest`, plus semver tags — pin as tightly as you like: `0.8.2`, `0.8`, `0`.
Built for `linux/amd64` and `linux/arm64`, so a Raspberry Pi or a NAS is fine.

## Your data

Everything lives in one directory:

```
data/
├── teamledger.db     the database — the whole ledger
├── receipts/         payment receipt uploads
└── backups/          nightly snapshots, last 14 kept
```

**To back up teamledger, copy the `data/` folder.** To move it to another
machine, copy `data/` next to a compose file and start it. No dump, no restore,
no matching database versions on the far end.

The app takes its own snapshot every night at 03:00 into `data/backups/`. Those
are ordinary SQLite files — to restore one, stop the app, copy it over
`data/teamledger.db`, and start again.

Nothing in this image is your data, and nothing phones home. The published image
is checked on every build to confirm it carries no database, no receipts, no
`.env` and no git history.

## Configuration

All optional. Set them in the compose file's `environment:` block.

| Variable | Notes |
|---|---|
| `TZ` | Your team's timezone, or the schedule drifts a day around midnight. |
| `APP_URL` | The URL you actually browse to, including the scheme. |
| `SECURE_COOKIES` | Default **off**. Turn on only when TLS is in front. |
| `TRUST_PROXY` | Default **off**. Turn on only when a proxy you control sets `X-Forwarded-For`. |
| `ICAL_SYNC_INTERVAL_MINUTES` | Default 360. `0` disables the background sync. |
| `SESSION_SECRET` | Generated on first boot and stored in the database. Set only to manage it yourself. |
| `BACKUPS` | `off` disables the nightly snapshot. |
| `DATA_DIR` | Where the database, backups and receipts live. Default `/app/data`. |
| `LOGIN_RATE_MAX` / `LOGIN_RATE_WINDOW_MS` | Failed logins per window. Defaults: 10 per 15 minutes. |

### Behind an HTTPS reverse proxy

```yaml
environment:
  APP_URL: https://teamledger.example.com
  SECURE_COOKIES: "true"
  TRUST_PROXY: "1"
```

Both switches default to off, and neither is inferred from `NODE_ENV`.
`SECURE_COOKIES` on without TLS gives you a cookie the browser accepts and then
refuses to send back — you sign in and land on the login form again with no
error. `TRUST_PROXY` on *without* a real proxy lets anyone forge
`X-Forwarded-For` and hand themselves a fresh rate-limit bucket, turning the
login limiter into unlimited password guesses.

## Notes

- **One admin account** — the treasurer. No co-treasurer, no password reset.
- **No parent-facing view.** Parents do not log in; you send them a PDF statement.
- **One writer at a time.** SQLite in WAL mode allows unlimited concurrent
  readers. For one treasurer and a few parents this is not a limit you can reach.
- All amounts are stored as integer cents. Per-player shares are computed to sum
  to the team total exactly, so a 15-player roster on $4,075.00 shows some
  players at $271.67 and some at $271.66 rather than rounding everyone up.

Source, screenshots and full documentation:
<https://github.com/raymondoooo/teamledger>

AGPL-3.0-or-later.
