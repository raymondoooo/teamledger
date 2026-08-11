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

- **`.dockerignore` is load-bearing.** `db/data` is the Postgres bind mount, owned
  by the container's postgres user; without it the build fails with a permission
  error the moment the stack has run once.
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
