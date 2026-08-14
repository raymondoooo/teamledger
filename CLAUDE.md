# Notes for contributors

Things that are easy to get wrong in this codebase, and why they are the way they
are. Read this before changing anything that touches money.

## The one idea worth understanding first

TeamSnap is the schedule system of record. This app **imports** its iCal feed and
never publishes one. The point of the import is that the calendar *drives the
budget*: a cost rule of "$75 per game" multiplied by the imported games produces
the ref-fee line, and a trainer's rate times their sessions produces the training
line. Those are the two numbers a treasurer otherwise totals by hand.

If you find yourself building an outbound `.ics` feed, that is a
misunderstanding — it was considered and deliberately rejected.

## Storage

The database is **SQLite**, embedded in the app container as a single file at
`$DATA_DIR/teamledger.db` (default `/app/data`). There is no database service.
That directory *is* the install — database, WAL sidecars, receipts and the
nightly `VACUUM INTO` snapshots — which is what makes "back it up" mean "copy one
folder" and what lets the app snapshot itself.

Things that will bite you, all of them load-bearing:

- **Foreign keys are OFF by default in SQLite.** `db/index.ts` sets
  `pragma foreign_keys = ON` on the connection. Without it every
  `onDelete: 'cascade'` in the schema silently does nothing and deleting a
  season leaves its expenses behind as orphans that still total into somebody's
  budget. There is a test for this; do not delete it.
- **`text({ enum: [...] })` is a TypeScript constraint only.** SQLite will accept
  any string. The two columns where a bad value moves money rather than merely
  looking wrong — `cost_rules.kind` and `expenses.source` — carry real `CHECK`
  constraints as well. `source = 'derived'` in particular decides which rows
  `recalculateDerivedExpenses` deletes and rewrites.
- **Timestamps are `integer(..., { mode: 'timestamp' })`** — unix seconds on
  disk, a JS `Date` in the app, which is exactly what node-postgres handed back,
  so nothing above the storage layer had to change.
- **Calendar dates are `text`**, holding a plain `'YYYY-MM-DD'`. Do not "fix"
  them into timestamps. They were always plain dates; Postgres had to be *forced*
  to behave that way with a `setTypeParser` hack, and text is the natural fit.
- **The driver is synchronous.** Drizzle's builders still work under `await`, so
  existing code reads unchanged, and `db.get()` / `db.run()` are used where a
  bare `sql` fragment is needed — note that `db.execute()` does not exist on this
  dialect and `db.get()` returns **the row itself**, not `{ rows: [...] }`. If
  you ever add a transaction, `db.transaction()` here is synchronous: passing it
  an `async` callback will not do what the pg version did.

## Nothing private leaves the server

This app holds a real family's financial records. A published Docker image and a
pushed git commit are both world-readable and effectively permanent — deleting a
tag or committing a deletion does not undo either. So this is enforced by CI
gates, not by care:

- **`PUBLISHED IMAGE MUST CONTAIN NO DATA`** builds the image and then proves the
  artifact is clean: nothing under `/app/data`, no `.db`/`.sqlite`/`.dump`/export
  anywhere, no `.env`, no `.git`. `.dockerignore` is what prevents the leak; this
  proves it actually worked this time.
- **`no-secrets`** runs before anything else and fails if a database, receipt,
  `.env` or key is *tracked* — in the working tree or anywhere in history.
  `.gitignore` does nothing for a file that is already tracked, which is the way
  this normally goes wrong.

Both gates were verified against a deliberately poisoned image and a planted
`.env`, so they are known to fail rather than merely known to pass. If you touch
`.dockerignore`, `.gitignore` or the `COPY` lines in the `Dockerfile`, assume you
are touching this guarantee.

`data/` is the whole install — database, WAL sidecars, nightly backups and
receipt uploads. It is excluded from git and from the build context, and it is a
mount point at runtime, so it could only ever end up in an image by someone
removing that exclusion.

## Money

**Every amount is an integer number of cents.** There is no float anywhere in the
money path, and there should not be.

`server/src/services/budget.ts` is the single source of the arithmetic. Screens,
exports and rollover all call `computeSeasonBudget`; nothing recomputes a total
inline. If you need a number, get it from there.

Per-player shares are computed by `splitEvenly` so they sum *exactly* to the team
total — leftover pennies are handed out one at a time rather than rounding every
player up. That is why a 15-player roster on $4,075.00 shows some players at
$271.67 and some at $271.66. The single "due per player" figure is
`quotedShareCents`, rounded up, and is intentionally a cent above the exact
share. There are tests pinning both.

`formatCents` on the server and `fmt` in `web/src/api.ts` must stay in step. They
were allowed to diverge once and the screen said `$4350.00` while the PDF said
`$4,350.00`.

## Two numbers that look like one

- **Trainer forecast vs payable.** `forecastCents` covers the whole season,
  including future and expected-but-unscheduled sessions — that is what dues have
  to collect. `earnedToDateCents` counts only sessions that have already
  happened, and is the only thing that can be *owed*. Collapsing them would
  either show money owed for work not yet done, or have the team collect less
  than it eventually pays out.
- **Team credits vs player credits.** A row in `credits` is a team pot split
  evenly across the roster. A row in `player_credits` reduces one player's bill
  alone. Both are money the team has received, so the books still balance:
  `sum(dues) + sum(player fundraising) == netDue`.

## Derived vs manual expenses

Rows in `expenses` with `source = 'derived'` are owned by the cost-rule engine and
are **deleted and rewritten** on every `recalculateDerivedExpenses` call. Never
edit them directly, and never hang state off them — that is why marking a derived
expense as paid is refused, and why tournaments carry their own `paidOn` and
`bankTransactionId` instead of relying on the expense row they generate.

`recalculateDerivedExpenses(seasonId)` must be called after anything that changes
rules, trainers, events, tournaments or charges. The API routes already do this.

Trainers are loaded **scoped to the season's team**. They were once loaded
globally, which was harmless until expected-session counts could bill with no
events attached — at which point every team's coach would have appeared on every
other team's budget.

## Calendar sync

- `events.typeConfirmed` means a human chose the type. `sync.ts` must never
  overwrite the type of a confirmed row, or every re-sync would silently undo the
  treasurer's corrections and change the budget.
- `classifyEvent` is a guess over inconsistent titles. `\b` does not match before
  `@`, and a bare `\bat\b` misfires on "Team photos at the field" — both are
  covered by tests. Do not "simplify" that regex.
- iCal string fields arrive either as a plain string or as `{val, params}`.
  Everything goes through the `text()` helper in `sync.ts`.
- Recurring events **are** expanded, in `expandFeedOccurrences`. Each occurrence
  gets `${uid}#${startISO}` as its external id, so week 7 keeps its own confirmed
  type, trainer and charge overrides when the series re-syncs. A `RECURRENCE-ID`
  entry is skipped as a standalone event because the expander folds it into its
  parent — importing it too would bill that week twice.
- Events absent from a re-synced feed are cancelled, **future ones only**. Feeds
  that publish a rolling window drop past events as they age out, and cancelling
  those would erase costs the team really incurred.

## PDF fonts

`exports.ts` embeds DejaVu Sans from `/app/fonts`, installed in the Dockerfile.
Do not go back to pdfkit's built-in Helvetica: it is WinAnsi-only, so any name
outside Latin-1 rendered as mojibake in a statement emailed to a parent, and the
request still returned 200 so nothing surfaced it. `hasUnicodeFonts` falls back
to the built-in faces when the font is absent, which is what a contributor
running `npm test` outside the container hits — that path must keep producing a
valid PDF rather than throwing.

`newDoc()` is the only place a `PDFDocument` is constructed. It exists so font
registration happens exactly once per document.

## Partial updates

Drizzle skips `undefined` keys in `.set()`, which is what makes a partial `PATCH`
leave untouched columns alone. Do not normalise a field unconditionally in an
update handler — `parentEmail: body.parentEmail || null` turned "not sent" into an
explicit `null` and silently wiped stored addresses. Guard with
`if ('field' in body)`.

## Frontend conventions

`web/src/ui.tsx` holds the shared page furniture: `AddSection` (a section whose
add-form is hidden behind a button), `Collapsible`, `EditableCard` (read-only
until you click Edit) and `SectionHead`. Use them rather than hand-rolling a
heading and a toggle — every page previously had its add-form permanently open
below its table, where on real data it was several screens down and looked
missing.

Tables mark secondary columns `hide-sm`; they disappear below 640px and stay in
the exports. Mobile rules live in two media queries at the bottom of
`styles.css` — nothing above them should assume a viewport.

## Deployment quirks

- **Every Dockerfile stage must stay on `node:22-alpine`.** better-sqlite3 is a
  native module compiled against a Node ABI, and the final stage copies
  `node_modules` from `deps`, so a stage that drifts produces an image that
  builds fine and then dies on the first query. 26 fails to build and 24 builds
  and then segfaults at runtime, so this is not theoretical. Both stages that run
  `npm ci` need `python3 make g++` — the package bundles a musl prebuild, but its
  install script still falls back to node-gyp and `npm ci` fails without a
  compiler. The runtime stage has none of it, and CI asserts that.
- **`.dockerignore` is load-bearing.** `data/` holds a real install — excluded so
  a contributor's own team finances can never be baked into a published image,
  and because `/app/data` is a mount point that would shadow it anyway. `db/data`
  stays ignored for anyone still carrying the old Postgres bind mount: it is
  owned by the container's postgres user and fails the build outright.
- The Dockerfile puts `web-dist` and `migrations` beside `dist/` at the WORKDIR
  root because both are resolved from `process.cwd()`, not their in-repo paths.
- The app runs as the `node` user and ships no build toolchain. CI asserts both.
- `drizzle-orm` is duplicated as a root devDependency. That is deliberate:
  `drizzle-kit` hoists to the workspace root and cannot otherwise resolve
  `drizzle-orm/version` from `server/node_modules`. Being a devDependency, it
  stays out of the runtime image.
- Remaining `npm audit` moderates are the esbuild-inside-`drizzle-kit` dev chain,
  which never ships.

## CI

`.github/workflows/docker-publish.yml` builds the image and exercises it the way
a new self-hoster would — empty database, no host state. It asserts the things
that would be embarrassing to ship broken: the setup screen is claimable only
once, the API is closed without a session, the money math round-trips to
$271.67, exports are real PDFs and BOM-prefixed CSVs, the app is non-root, and
data survives a container recreate. A `v*` tag additionally publishes multi-arch
images to Docker Hub and GHCR.
