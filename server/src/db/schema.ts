import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Every money column in this schema is an integer number of CENTS. Team dues
// divide badly ($4,075 across 15 players is $271.666…), and doing that in
// floating point is how a ledger ends up a penny short of the bank. Rounding
// happens once, deliberately, in services/budget.ts.

// SQLite has no enum type, so these are plain text columns with a TypeScript
// literal union over them. The tuples live here rather than being inlined at
// each column because several are shared by two tables, and two copies of a
// list of allowed values is two copies that can drift apart.
//
// Note what this costs: `text({ enum })` is a compile-time constraint only.
// The database will accept any string. Where a bad value would corrupt money
// rather than just look wrong, there is a CHECK constraint as well — see
// cost_rules.kind and expenses.source below.
const SEASON_TERM = ['fall', 'spring', 'summer', 'winter'] as const;
const SEASON_STATUS = ['active', 'closed'] as const;
const EVENT_TYPE = ['game', 'practice', 'tournament', 'other'] as const;
const EVENT_SOURCE = ['ical', 'manual'] as const;
const RATE_UNIT = ['per_session', 'flat'] as const;
const COST_RULE_KIND = ['ref_fee', 'training'] as const;
const EXPENSE_CATEGORY = ['training', 'ref_fees', 'tournaments', 'jerseys', 'misc'] as const;
const EXPENSE_SOURCE = ['manual', 'derived'] as const;
const CREDIT_KIND = ['credit', 'fundraiser', 'sponsor'] as const;
const PAYMENT_METHOD = ['venmo', 'cash', 'zelle', 'check', 'other'] as const;

// Which of the season's two instalments a payment is. Lets the roster screen
// show a tick box per instalment and toggle it without guessing which payment
// row it meant.
const INSTALLMENT = ['first', 'final', 'other'] as const;

// What a bank line represents. The first three are written by the app when you
// mark payments transferred or pay a trainer; the rest are hand-entered.
const BANK_TXN_KIND = [
  'player_transfer',
  'trainer_payment',
  'expense_payment',
  'deposit',
  'withdrawal',
  'fee',
  'adjustment',
] as const;

// Timestamps are stored as integer unix seconds and handed back as JS `Date`,
// which is what node-postgres did with `timestamptz` — so the services above
// this layer did not have to change.
const now = sql`(unixepoch())`;

// Single admin account — the treasurer. Created through the first-run setup
// screen rather than seeded from env vars, so a fresh container is safe to
// start before anyone has decided on a password.
export const adminUsers = sqliteTable('admin_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
});

// Server-side settings that have to survive a restart but are not part of the
// team's books. Currently just the auto-generated session secret, which lives
// here so `docker compose up` needs no .env at all — see auth.ts.
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
});

export const teams = sqliteTable('teams', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  club: text('club'),
  ageGroup: text('age_group'),
  sport: text('sport').notNull().default('soccer'),
  // The treasurer's own Venmo, for the messages the Budget page drafts to post
  // on the team board. Team-scoped rather than global: someone treasurer for
  // two teams may well collect for them separately.
  venmoHandle: text('venmo_handle'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
});

export const seasons = sqliteTable(
  'seasons',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    term: text('term', { enum: SEASON_TERM }).notNull(),
    year: integer('year').notNull(),
    // What the treasurer calls this season, when "Fall 2026" is not it — a club
    // that bills annually wants "2026-2027 Season" on the statement. Display
    // only: term and year stay the identity, so rollover and the one-season-
    // per-term rule are untouched.
    name: text('name'),
    startDate: text('start_date'),
    endDate: text('end_date'),
    status: text('status', { enum: SEASON_STATUS }).notNull().default('active'),
    // The spreadsheet's two-payment plan: an agreed first installment, with the
    // remainder due later. Null first payment means "all due at once".
    firstPaymentCents: integer('first_payment_cents'),
    firstPaymentDue: text('first_payment_due'),
    finalPaymentDue: text('final_payment_due'),
    // Set by rollover when the season is closed, so historical seasons keep
    // reporting the numbers they ended with even if a rule is edited later.
    closedAt: integer('closed_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  },
  (t) => [
    // One Spring 2026 per team. Rollover relies on this to avoid creating a
    // duplicate season when it is run twice.
    uniqueIndex('seasons_team_term_year_idx').on(t.teamId, t.term, t.year),
  ],
);

// A player belongs to the team, not the season — that is what makes rollover
// possible without re-typing the roster every year.
export const players = sqliteTable('players', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  parentName: text('parent_name'),
  parentEmail: text('parent_email'),
  parentPhone: text('parent_phone'),
  venmoHandle: text('venmo_handle'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
});

// Roster membership for one season. Jersey number and size live here because
// they change year to year.
export const seasonPlayers = sqliteTable(
  'season_players',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    jerseyNumber: text('jersey_number'),
    size: text('size'),
    // Set when a player owes something other than an even split — a sibling
    // discount, a scholarship, a late joiner paying half a season.
    duesOverrideCents: integer('dues_override_cents'),
    // Brought forward by rollover. Positive means they were owed money at the
    // end of last season (it reduces this season's bill), negative means they
    // still owed. The spreadsheet's -$10.33 overpayments land here.
    carriedBalanceCents: integer('carried_balance_cents').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  },
  (t) => [uniqueIndex('season_players_season_player_idx').on(t.seasonId, t.playerId)],
);

export const trainers = sqliteTable('trainers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  initials: text('initials'),
  // Charged for every event this trainer is attached to. This is the rate the
  // budget actually uses — a trainer-scoped cost_rule can still override it for
  // one event type, but with no rule at all the trainer still gets paid.
  defaultRateCents: integer('default_rate_cents').notNull().default(0),
  rateUnit: text('rate_unit', { enum: RATE_UNIT }).notNull().default('per_session'),
  // The trainer who runs everything by default. Imported and hand-added events
  // get attached to them when no other trainer is named, so the common case
  // needs no per-event fiddling. At most one per team; setting a new one clears
  // the old.
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  // How many sessions you expect to owe this trainer for over the season.
  // Same rule as cost_rules.expectedCount: the larger of this and the number
  // actually on the calendar is what gets billed, so a season can be budgeted
  // before TeamSnap has a single practice in it.
  expectedSessions: integer('expected_sessions').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
});

export const icalFeeds = sqliteTable('ical_feeds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  seasonId: integer('season_id')
    .notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  label: text('label'),
  lastSyncedAt: integer('last_synced_at', { mode: 'timestamp' }),
  lastEtag: text('last_etag'),
  lastError: text('last_error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
});

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    feedId: integer('feed_id').references(() => icalFeeds.id, { onDelete: 'set null' }),
    source: text('source', { enum: EVENT_SOURCE }).notNull().default('manual'),
    // VEVENT UID. Null for events typed in by hand.
    externalUid: text('external_uid'),
    title: text('title').notNull(),
    location: text('location'),
    startsAt: integer('starts_at', { mode: 'timestamp' }).notNull(),
    endsAt: integer('ends_at', { mode: 'timestamp' }),
    type: text('type', { enum: EVENT_TYPE }).notNull().default('other'),
    // Set once a human picks the type. sync.ts must never overwrite the type of
    // a confirmed row, or every re-sync would undo the treasurer's corrections
    // to TeamSnap's inconsistent event titles.
    typeConfirmed: integer('type_confirmed', { mode: 'boolean' }).notNull().default(false),
    trainerId: integer('trainer_id').references(() => trainers.id, { onDelete: 'set null' }),
    cancelled: integer('cancelled', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  },
  (t) => [
    // Re-syncing the same feed updates events in place instead of duplicating
    // them. Scoped to the season so the same fixture in two seasons is fine.
    uniqueIndex('events_season_uid_idx').on(t.seasonId, t.externalUid),
  ],
);

// "Ref fee is $75 a game", "Sam charges $200 a session". These generate the
// derived expenses that the spreadsheet had as hand-totalled numbers.
export const costRules = sqliteTable(
  'cost_rules',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: COST_RULE_KIND }).notNull(),
    label: text('label').notNull(),
    eventType: text('event_type', { enum: EVENT_TYPE }).notNull(),
    // Set for training rules that apply to one trainer's sessions only.
    trainerId: integer('trainer_id').references(() => trainers.id, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents').notNull(),
    unit: text('unit', { enum: RATE_UNIT }).notNull().default('per_session'),
    // How many of these you expect over the season, for budgeting before the
    // schedule exists. The engine bills whichever is larger, this or the number
    // actually on the calendar — so dues can be set in pre-season and still
    // follow reality if more sessions get added later.
    expectedCount: integer('expected_count').notNull().default(0),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  },
  () => [
    // Enforced in the database, not just in TypeScript: `kind` decides which
    // budget line a rule feeds, so a typo here would silently move money
    // between the ref-fee and training totals.
    check('cost_rules_kind_check', sql`kind in ('ref_fee', 'training')`),
  ],
);

// The spreadsheet's "Tournament Name / Dates / Registration Fee" block. Kept as
// its own table rather than plain expense rows so the dates travel with the fee
// and an entry can be marked as a guess.
export const tournaments = sqliteTable('tournaments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  seasonId: integer('season_id')
    .notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  startDate: text('start_date'),
  endDate: text('end_date'),
  registrationCents: integer('registration_cents').notNull().default(0),
  // When the registration fee actually left the account. Tournaments carry
  // their own paid state because the expense row they generate is derived and
  // gets rewritten on every recalculation.
  paidOn: text('paid_on'),
  bankTransactionId: integer('bank_transaction_id'),
  // A placeholder for a tournament you intend to enter but have not booked.
  // Counts toward the budget exactly the same; the flag is there so you can see
  // at a glance which numbers are still guesses.
  estimated: integer('estimated', { mode: 'boolean' }).notNull().default(false),
  note: text('note'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
});

// One charge against one event, materialized. Keeping the amount per event is
// what lets a single rained-out game carry a $0 ref fee without inventing an
// exception to the rule itself.
//
// A charge comes from exactly one of two places: a cost rule (ruleId set) or a
// trainer's own rate (trainerId set). Both are nullable so either origin can be
// recorded; the pair is what the unique indexes below key on.
export const eventCharges = sqliteTable(
  'event_charges',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    ruleId: integer('rule_id').references(() => costRules.id, { onDelete: 'cascade' }),
    trainerId: integer('trainer_id').references(() => trainers.id, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents').notNull(),
    // Once true, recalculation leaves this row's amount alone.
    overridden: integer('overridden', { mode: 'boolean' }).notNull().default(false),
    note: text('note'),
  },
  (t) => [
    uniqueIndex('event_charges_event_rule_idx').on(t.eventId, t.ruleId),
    uniqueIndex('event_charges_event_trainer_idx').on(t.eventId, t.trainerId),
  ],
);

export const expenses = sqliteTable(
  'expenses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    category: text('category', { enum: EXPENSE_CATEGORY }).notNull(),
    label: text('label').notNull(),
    amountCents: integer('amount_cents').notNull(),
    // 'derived' rows are owned by the cost-rule engine and are rewritten on every
    // recalculation — do not edit them by hand, edit the rule or the charge.
    source: text('source', { enum: EXPENSE_SOURCE }).notNull().default('manual'),
    ruleId: integer('rule_id').references(() => costRules.id, { onDelete: 'cascade' }),
    incurredOn: text('incurred_on'),
    // When the money actually left the team account, which is rarely the day the
    // cost was incurred. Null means "owed but not yet paid".
    paidOn: text('paid_on'),
    // The bank line this created, so editing the date moves it and unmarking
    // removes it rather than leaving an orphan withdrawal.
    bankTransactionId: integer('bank_transaction_id'),
    note: text('note'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  },
  () => [
    // Enforced in the database, not just in TypeScript. `recalculateDerivedExpenses`
    // deletes every row where source = 'derived'; a row that should have said
    // 'derived' and did not would survive as a permanent duplicate of a cost the
    // engine re-adds on the next pass, quietly inflating the season total.
    check('expenses_source_check', sql`source in ('manual', 'derived')`),
  ],
);

// Anything that reduces what the team has to collect: leftover money from last
// season, fundraiser proceeds, sponsor cheques.
export const credits = sqliteTable('credits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  seasonId: integer('season_id')
    .notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: CREDIT_KIND }).notNull(),
  label: text('label').notNull(),
  amountCents: integer('amount_cents').notNull(),
  receivedOn: text('received_on'),
  note: text('note'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
});

// Fundraising raised by one player, credited to that player alone.
//
// Deliberately NOT part of `credits`: money in that table is a team pot that
// reduces everyone's share evenly, whereas this reduces only the bill of the kid
// who sold the raffle books. The team still receives the cash either way, so the
// books balance — see the note in services/budget.ts.
export const playerCredits = sqliteTable('player_credits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  seasonId: integer('season_id')
    .notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  playerId: integer('player_id')
    .notNull()
    .references(() => players.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: CREDIT_KIND }).notNull().default('fundraiser'),
  label: text('label').notNull(),
  amountCents: integer('amount_cents').notNull(),
  receivedOn: text('received_on'),
  note: text('note'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
});

// The ledger. Every dollar a parent hands over is a row here — this is the
// audit trail the spreadsheet's Yes/No columns could not provide.
export const payments = sqliteTable('payments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  seasonId: integer('season_id')
    .notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  playerId: integer('player_id')
    .notNull()
    .references(() => players.id, { onDelete: 'cascade' }),
  paidAt: text('paid_at').notNull(),
  amountCents: integer('amount_cents').notNull(),
  method: text('method', { enum: PAYMENT_METHOD }).notNull().default('venmo'),
  installment: text('installment', { enum: INSTALLMENT }).notNull().default('other'),
  note: text('note'),
  receiptPath: text('receipt_path'),
  // A parent's Venmo lands in the treasurer's *personal* account first. This is
  // the date it actually reached the team's bank account — null means the
  // treasurer is still personally holding that money. The spreadsheet tracked
  // the same thing with a "transferred?" column.
  transferredOn: text('transferred_on'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
});

// The team's real bank account. Belongs to the TEAM, not a season — a bank
// account does not reset in August, and the balance has to carry across a
// rollover the way the real one does.
export const bankAccounts = sqliteTable('bank_accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default('Team account'),
  // The balance on the day you started keeping the books here, so the running
  // balance can match the real statement from day one.
  startingBalanceCents: integer('starting_balance_cents').notNull().default(0),
  startingOn: text('starting_on'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
});

// Every debit and credit against the account — the ledger book, kept honest.
//
// `amountCents` is SIGNED: positive is money in, negative is money out. One
// column rather than separate debit/credit columns means the running balance is
// a plain running sum and there is no way to enter a line that is neither.
export const bankTransactions = sqliteTable('bank_transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id')
    .notNull()
    .references(() => bankAccounts.id, { onDelete: 'cascade' }),
  // Which season the money relates to, where that is meaningful. Null for
  // things like bank fees that belong to no particular season.
  seasonId: integer('season_id').references(() => seasons.id, { onDelete: 'set null' }),
  occurredOn: text('occurred_on').notNull(),
  description: text('description').notNull(),
  amountCents: integer('amount_cents').notNull(),
  kind: text('kind', { enum: BANK_TXN_KIND }).notNull().default('adjustment'),
  // Ticked once the line has been matched against the real bank statement.
  reconciled: integer('reconciled', { mode: 'boolean' }).notNull().default(false),
  note: text('note'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
});

// Money paid out to a trainer. What they have earned comes from the schedule;
// this is what has actually left the account, so the difference is what the
// team still owes them.
export const trainerPayments = sqliteTable('trainer_payments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  seasonId: integer('season_id')
    .notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  trainerId: integer('trainer_id')
    .notNull()
    .references(() => trainers.id, { onDelete: 'cascade' }),
  paidOn: text('paid_on').notNull(),
  amountCents: integer('amount_cents').notNull(),
  method: text('method', { enum: PAYMENT_METHOD }).notNull().default('venmo'),
  note: text('note'),
  // The bank line this created, so deleting the payment can remove it too.
  bankTransactionId: integer('bank_transaction_id').references(() => bankTransactions.id, {
    onDelete: 'set null',
  }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
});
