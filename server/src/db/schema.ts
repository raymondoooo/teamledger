import {
  boolean,
  date,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Every money column in this schema is an integer number of CENTS. Team dues
// divide badly ($4,075 across 15 players is $271.666…), and doing that in
// floating point is how a ledger ends up a penny short of the bank. Rounding
// happens once, deliberately, in services/budget.ts.

export const seasonTerm = pgEnum('season_term', ['fall', 'spring', 'summer', 'winter']);
export const seasonStatus = pgEnum('season_status', ['active', 'closed']);
export const eventType = pgEnum('event_type', ['game', 'practice', 'tournament', 'other']);
export const eventSource = pgEnum('event_source', ['ical', 'manual']);
export const rateUnit = pgEnum('rate_unit', ['per_session', 'flat']);
export const costRuleKind = pgEnum('cost_rule_kind', ['ref_fee', 'training']);
export const expenseCategory = pgEnum('expense_category', [
  'training',
  'ref_fees',
  'tournaments',
  'jerseys',
  'misc',
]);
export const expenseSource = pgEnum('expense_source', ['manual', 'derived']);
export const creditKind = pgEnum('credit_kind', ['credit', 'fundraiser', 'sponsor']);
export const paymentMethod = pgEnum('payment_method', [
  'venmo',
  'cash',
  'zelle',
  'check',
  'other',
]);

// Which of the season's two instalments a payment is. Lets the roster screen
// show a tick box per instalment and toggle it without guessing which payment
// row it meant.
export const installment = pgEnum('installment', ['first', 'final', 'other']);

// What a bank line represents. The first three are written by the app when you
// mark payments transferred or pay a trainer; the rest are hand-entered.
export const bankTxnKind = pgEnum('bank_txn_kind', [
  'player_transfer',
  'trainer_payment',
  'expense_payment',
  'deposit',
  'withdrawal',
  'fee',
  'adjustment',
]);

// Single admin account — the treasurer. Created through the first-run setup
// screen rather than seeded from env vars, so a fresh container is safe to
// start before anyone has decided on a password.
export const adminUsers = pgTable('admin_users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const teams = pgTable('teams', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  club: text('club'),
  ageGroup: text('age_group'),
  sport: text('sport').notNull().default('soccer'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const seasons = pgTable(
  'seasons',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    term: seasonTerm('term').notNull(),
    year: integer('year').notNull(),
    startDate: date('start_date'),
    endDate: date('end_date'),
    status: seasonStatus('status').notNull().default('active'),
    // The spreadsheet's two-payment plan: an agreed first installment, with the
    // remainder due later. Null first payment means "all due at once".
    firstPaymentCents: integer('first_payment_cents'),
    firstPaymentDue: date('first_payment_due'),
    finalPaymentDue: date('final_payment_due'),
    // Set by rollover when the season is closed, so historical seasons keep
    // reporting the numbers they ended with even if a rule is edited later.
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One Spring 2026 per team. Rollover relies on this to avoid creating a
    // duplicate season when it is run twice.
    teamTermYear: uniqueIndex('seasons_team_term_year_idx').on(t.teamId, t.term, t.year),
  }),
);

// A player belongs to the team, not the season — that is what makes rollover
// possible without re-typing the roster every year.
export const players = pgTable('players', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  parentName: text('parent_name'),
  parentEmail: text('parent_email'),
  parentPhone: text('parent_phone'),
  venmoHandle: text('venmo_handle'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Roster membership for one season. Jersey number and size live here because
// they change year to year.
export const seasonPlayers = pgTable(
  'season_players',
  {
    id: serial('id').primaryKey(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    seasonPlayer: uniqueIndex('season_players_season_player_idx').on(t.seasonId, t.playerId),
  }),
);

export const trainers = pgTable('trainers', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  initials: text('initials'),
  // Charged for every event this trainer is attached to. This is the rate the
  // budget actually uses — a trainer-scoped cost_rule can still override it for
  // one event type, but with no rule at all the trainer still gets paid.
  defaultRateCents: integer('default_rate_cents').notNull().default(0),
  rateUnit: rateUnit('rate_unit').notNull().default('per_session'),
  // The trainer who runs everything by default. Imported and hand-added events
  // get attached to them when no other trainer is named, so the common case
  // needs no per-event fiddling. At most one per team; setting a new one clears
  // the old.
  isPrimary: boolean('is_primary').notNull().default(false),
  // How many sessions you expect to owe this trainer for over the season.
  // Same rule as cost_rules.expectedCount: the larger of this and the number
  // actually on the calendar is what gets billed, so a season can be budgeted
  // before TeamSnap has a single practice in it.
  expectedSessions: integer('expected_sessions').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const icalFeeds = pgTable('ical_feeds', {
  id: serial('id').primaryKey(),
  seasonId: integer('season_id')
    .notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  label: text('label'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  lastEtag: text('last_etag'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable(
  'events',
  {
    id: serial('id').primaryKey(),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    feedId: integer('feed_id').references(() => icalFeeds.id, { onDelete: 'set null' }),
    source: eventSource('source').notNull().default('manual'),
    // VEVENT UID. Null for events typed in by hand.
    externalUid: text('external_uid'),
    title: text('title').notNull(),
    location: text('location'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    type: eventType('type').notNull().default('other'),
    // Set once a human picks the type. sync.ts must never overwrite the type of
    // a confirmed row, or every re-sync would undo the treasurer's corrections
    // to TeamSnap's inconsistent event titles.
    typeConfirmed: boolean('type_confirmed').notNull().default(false),
    trainerId: integer('trainer_id').references(() => trainers.id, { onDelete: 'set null' }),
    cancelled: boolean('cancelled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Re-syncing the same feed updates events in place instead of duplicating
    // them. Scoped to the season so the same fixture in two seasons is fine.
    seasonUid: uniqueIndex('events_season_uid_idx').on(t.seasonId, t.externalUid),
  }),
);

// "Ref fee is $75 a game", "Sam charges $200 a session". These generate the
// derived expenses that the spreadsheet had as hand-totalled numbers.
export const costRules = pgTable('cost_rules', {
  id: serial('id').primaryKey(),
  seasonId: integer('season_id')
    .notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  kind: costRuleKind('kind').notNull(),
  label: text('label').notNull(),
  eventType: eventType('event_type').notNull(),
  // Set for training rules that apply to one trainer's sessions only.
  trainerId: integer('trainer_id').references(() => trainers.id, { onDelete: 'cascade' }),
  amountCents: integer('amount_cents').notNull(),
  unit: rateUnit('unit').notNull().default('per_session'),
  // How many of these you expect over the season, for budgeting before the
  // schedule exists. The engine bills whichever is larger, this or the number
  // actually on the calendar — so dues can be set in pre-season and still
  // follow reality if more sessions get added later.
  expectedCount: integer('expected_count').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// The spreadsheet's "Tournament Name / Dates / Registration Fee" block. Kept as
// its own table rather than plain expense rows so the dates travel with the fee
// and an entry can be marked as a guess.
export const tournaments = pgTable('tournaments', {
  id: serial('id').primaryKey(),
  seasonId: integer('season_id')
    .notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  startDate: date('start_date'),
  endDate: date('end_date'),
  registrationCents: integer('registration_cents').notNull().default(0),
  // When the registration fee actually left the account. Tournaments carry
  // their own paid state because the expense row they generate is derived and
  // gets rewritten on every recalculation.
  paidOn: date('paid_on'),
  bankTransactionId: integer('bank_transaction_id'),
  // A placeholder for a tournament you intend to enter but have not booked.
  // Counts toward the budget exactly the same; the flag is there so you can see
  // at a glance which numbers are still guesses.
  estimated: boolean('estimated').notNull().default(false),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// One charge against one event, materialized. Keeping the amount per event is
// what lets a single rained-out game carry a $0 ref fee without inventing an
// exception to the rule itself.
//
// A charge comes from exactly one of two places: a cost rule (ruleId set) or a
// trainer's own rate (trainerId set). Both are nullable so either origin can be
// recorded; the pair is what the unique indexes below key on.
export const eventCharges = pgTable(
  'event_charges',
  {
    id: serial('id').primaryKey(),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    ruleId: integer('rule_id').references(() => costRules.id, { onDelete: 'cascade' }),
    trainerId: integer('trainer_id').references(() => trainers.id, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents').notNull(),
    // Once true, recalculation leaves this row's amount alone.
    overridden: boolean('overridden').notNull().default(false),
    note: text('note'),
  },
  (t) => ({
    eventRule: uniqueIndex('event_charges_event_rule_idx').on(t.eventId, t.ruleId),
    eventTrainer: uniqueIndex('event_charges_event_trainer_idx').on(t.eventId, t.trainerId),
  }),
);

export const expenses = pgTable('expenses', {
  id: serial('id').primaryKey(),
  seasonId: integer('season_id')
    .notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  category: expenseCategory('category').notNull(),
  label: text('label').notNull(),
  amountCents: integer('amount_cents').notNull(),
  // 'derived' rows are owned by the cost-rule engine and are rewritten on every
  // recalculation — do not edit them by hand, edit the rule or the charge.
  source: expenseSource('source').notNull().default('manual'),
  ruleId: integer('rule_id').references(() => costRules.id, { onDelete: 'cascade' }),
  incurredOn: date('incurred_on'),
  // When the money actually left the team account, which is rarely the day the
  // cost was incurred. Null means "owed but not yet paid".
  paidOn: date('paid_on'),
  // The bank line this created, so editing the date moves it and unmarking
  // removes it rather than leaving an orphan withdrawal.
  bankTransactionId: integer('bank_transaction_id'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Anything that reduces what the team has to collect: leftover money from last
// season, fundraiser proceeds, sponsor cheques.
export const credits = pgTable('credits', {
  id: serial('id').primaryKey(),
  seasonId: integer('season_id')
    .notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  kind: creditKind('kind').notNull(),
  label: text('label').notNull(),
  amountCents: integer('amount_cents').notNull(),
  receivedOn: date('received_on'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Fundraising raised by one player, credited to that player alone.
//
// Deliberately NOT part of `credits`: money in that table is a team pot that
// reduces everyone's share evenly, whereas this reduces only the bill of the kid
// who sold the raffle books. The team still receives the cash either way, so the
// books balance — see the note in services/budget.ts.
export const playerCredits = pgTable('player_credits', {
  id: serial('id').primaryKey(),
  seasonId: integer('season_id')
    .notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  playerId: integer('player_id')
    .notNull()
    .references(() => players.id, { onDelete: 'cascade' }),
  kind: creditKind('kind').notNull().default('fundraiser'),
  label: text('label').notNull(),
  amountCents: integer('amount_cents').notNull(),
  receivedOn: date('received_on'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// The ledger. Every dollar a parent hands over is a row here — this is the
// audit trail the spreadsheet's Yes/No columns could not provide.
export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  seasonId: integer('season_id')
    .notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  playerId: integer('player_id')
    .notNull()
    .references(() => players.id, { onDelete: 'cascade' }),
  paidAt: date('paid_at').notNull(),
  amountCents: integer('amount_cents').notNull(),
  method: paymentMethod('method').notNull().default('venmo'),
  installment: installment('installment').notNull().default('other'),
  note: text('note'),
  receiptPath: text('receipt_path'),
  // A parent's Venmo lands in the treasurer's *personal* account first. This is
  // the date it actually reached the team's bank account — null means the
  // treasurer is still personally holding that money. The spreadsheet tracked
  // the same thing in its "Ray Transferred" column.
  transferredOn: date('transferred_on'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// The team's real bank account. Belongs to the TEAM, not a season — a bank
// account does not reset in August, and the balance has to carry across a
// rollover the way the real one does.
export const bankAccounts = pgTable('bank_accounts', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default('Team account'),
  // The balance on the day you started keeping the books here, so the running
  // balance can match the real statement from day one.
  startingBalanceCents: integer('starting_balance_cents').notNull().default(0),
  startingOn: date('starting_on'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Every debit and credit against the account — the ledger book, kept honest.
//
// `amountCents` is SIGNED: positive is money in, negative is money out. One
// column rather than separate debit/credit columns means the running balance is
// a plain running sum and there is no way to enter a line that is neither.
export const bankTransactions = pgTable('bank_transactions', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id')
    .notNull()
    .references(() => bankAccounts.id, { onDelete: 'cascade' }),
  // Which season the money relates to, where that is meaningful. Null for
  // things like bank fees that belong to no particular season.
  seasonId: integer('season_id').references(() => seasons.id, { onDelete: 'set null' }),
  occurredOn: date('occurred_on').notNull(),
  description: text('description').notNull(),
  amountCents: integer('amount_cents').notNull(),
  kind: bankTxnKind('kind').notNull().default('adjustment'),
  // Ticked once the line has been matched against the real bank statement.
  reconciled: boolean('reconciled').notNull().default(false),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Money paid out to a trainer. What they have earned comes from the schedule;
// this is what has actually left the account, so the difference is what the
// team still owes them.
export const trainerPayments = pgTable('trainer_payments', {
  id: serial('id').primaryKey(),
  seasonId: integer('season_id')
    .notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  trainerId: integer('trainer_id')
    .notNull()
    .references(() => trainers.id, { onDelete: 'cascade' }),
  paidOn: date('paid_on').notNull(),
  amountCents: integer('amount_cents').notNull(),
  method: paymentMethod('method').notNull().default('venmo'),
  note: text('note'),
  // The bank line this created, so deleting the payment can remove it too.
  bankTransactionId: integer('bank_transaction_id').references(() => bankTransactions.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
