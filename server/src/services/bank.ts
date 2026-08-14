import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  bankAccounts,
  bankTransactions,
  eventCharges,
  events,
  payments,
  players,
  expenses,
  seasons,
  tournaments,
  trainerPayments,
  trainers,
} from '../db/schema.js';

// The team's real bank account, and the two things that make it disagree with
// the payment ledger if you do not track them:
//
//   1. A parent's Venmo arrives in the treasurer's personal account. Until it
//      is transferred, the team's books say the money is in but the bank says
//      otherwise. `payments.transferredOn` closes that gap.
//   2. A trainer earns money from the schedule long before they are paid. The
//      difference is a payable the team still owes.

export type LedgerLine = {
  id: number | null;
  occurredOn: string;
  description: string;
  amountCents: number;
  kind: string;
  reconciled: boolean;
  note: string | null;
  // Running balance after this line.
  balanceCents: number;
};

export type BankLedger = {
  accountId: number;
  name: string;
  startingBalanceCents: number;
  startingOn: string | null;
  lines: LedgerLine[];
  balanceCents: number;
  reconciledBalanceCents: number;
  // Collected from parents but still sitting in the treasurer's own account.
  untransferredCents: number;
  untransferredCount: number;
};

// One account per team, created on first use so no setup step is required.
export async function getOrCreateAccount(teamId: number) {
  const [existing] = await db
    .select()
    .from(bankAccounts)
    .where(eq(bankAccounts.teamId, teamId))
    .limit(1);
  if (existing) return existing;
  const [created] = await db.insert(bankAccounts).values({ teamId }).returning();
  return created;
}

export async function getLedger(teamId: number): Promise<BankLedger> {
  const account = await getOrCreateAccount(teamId);

  const txns = await db
    .select()
    .from(bankTransactions)
    .where(eq(bankTransactions.accountId, account.id))
    // Ties broken by id so the running balance is stable across reloads when
    // several lines share a date.
    .orderBy(asc(bankTransactions.occurredOn), asc(bankTransactions.id));

  let balance = account.startingBalanceCents;
  const lines: LedgerLine[] = txns.map((t) => {
    balance += t.amountCents;
    return {
      id: t.id,
      occurredOn: t.occurredOn,
      description: t.description,
      amountCents: t.amountCents,
      kind: t.kind,
      reconciled: t.reconciled,
      note: t.note,
      balanceCents: balance,
    };
  });

  const reconciledBalanceCents = txns
    .filter((t) => t.reconciled)
    .reduce((s, t) => s + t.amountCents, account.startingBalanceCents);

  // Money this team has received from parents that has not reached the account.
  const held = await db
    .select({
      // `cast(... as integer)`, not Postgres's `::int` — SQLite cannot parse the
      // `::` cast at all and fails the whole query with `unrecognized token: ":"`,
      // which took down the entire Bank screen.
      total: sql<number>`cast(coalesce(sum(${payments.amountCents}), 0) as integer)`,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(payments)
    .innerJoin(seasons, eq(payments.seasonId, seasons.id))
    .where(and(eq(seasons.teamId, teamId), isNull(payments.transferredOn)));

  return {
    accountId: account.id,
    name: account.name,
    startingBalanceCents: account.startingBalanceCents,
    startingOn: account.startingOn,
    lines,
    balanceCents: balance,
    reconciledBalanceCents,
    untransferredCents: held[0]?.total ?? 0,
    untransferredCount: held[0]?.count ?? 0,
  };
}

// Marks a batch of player payments as having reached the team account and
// writes the single deposit line that represents the transfer. One line for the
// batch, because that is how it appears on the real statement — one Venmo
// cash-out, not one per parent.
export async function transferPayments(
  teamId: number,
  paymentIds: number[],
  transferredOn: string,
): Promise<{ transferred: number; amountCents: number; bankTransactionId: number | null }> {
  const account = await getOrCreateAccount(teamId);

  const rows = await db
    .select({
      id: payments.id,
      amountCents: payments.amountCents,
      seasonId: payments.seasonId,
      transferredOn: payments.transferredOn,
    })
    .from(payments)
    .innerJoin(seasons, eq(payments.seasonId, seasons.id))
    .where(and(eq(seasons.teamId, teamId), inArray(payments.id, paymentIds)));

  // Ignore anything already transferred so a double-click cannot deposit the
  // same money twice.
  const pending = rows.filter((r) => r.transferredOn === null);
  if (pending.length === 0) {
    return { transferred: 0, amountCents: 0, bankTransactionId: null };
  }

  const amountCents = pending.reduce((s, r) => s + r.amountCents, 0);

  const [txn] = await db
    .insert(bankTransactions)
    .values({
      accountId: account.id,
      seasonId: pending[0].seasonId,
      occurredOn: transferredOn,
      description: `Transfer from personal account (${pending.length} payment${
        pending.length === 1 ? '' : 's'
      })`,
      amountCents,
      kind: 'player_transfer',
    })
    .returning();

  await db
    .update(payments)
    .set({ transferredOn })
    .where(
      inArray(
        payments.id,
        pending.map((r) => r.id),
      ),
    );

  return { transferred: pending.length, amountCents, bankTransactionId: txn.id };
}

export type TrainerLedgerRow = {
  trainerId: number;
  name: string;
  rateCents: number;
  // Sessions that have already taken place. These are the only ones that can be
  // owed for.
  completedSessions: number;
  scheduledSessions: number;
  billedSessions: number;
  // Earned by sessions that have actually happened — what the team owes today.
  earnedToDateCents: number;
  // What the whole season is forecast to cost, including future and
  // expected-but-unscheduled sessions. Used for budgeting, never for payables.
  forecastCents: number;
  paidCents: number;
  // Positive = the team still owes them for work already done.
  owedCents: number;
  payments: { id: number; paidOn: string; amountCents: number; method: string; note: string | null }[];
};

// What each trainer has earned against what they have actually been paid.
//
// Two different numbers, deliberately:
//
//   owed      — only sessions that have already happened. You pay a trainer for
//               last week's work, not for a practice three weeks out, so once
//               you settle up this figure drops to zero and only climbs again as
//               more sessions elapse.
//   forecast  — the whole season including future and expected-but-unscheduled
//               sessions, matching what the budget collects from parents.
//
// Conflating them would either show you owing money for work not yet done, or
// have the team collect less than it will eventually pay out.
export async function trainerLedger(
  seasonId: number,
  asOf: Date = new Date(),
): Promise<TrainerLedgerRow[]> {
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  if (!season) throw new Error(`season ${seasonId} not found`);

  const roster = await db
    .select()
    .from(trainers)
    .where(eq(trainers.teamId, season.teamId));

  const seasonEvents = await db.select().from(events).where(eq(events.seasonId, seasonId));
  const eventIds = seasonEvents.map((e) => e.id);
  const charges = eventIds.length
    ? await db.select().from(eventCharges).where(inArray(eventCharges.eventId, eventIds))
    : [];

  const paid = await db
    .select()
    .from(trainerPayments)
    .where(eq(trainerPayments.seasonId, seasonId));

  const eventById = new Map(seasonEvents.map((e) => [e.id, e] as const));

  return roster.map((t) => {
    const mine = charges.filter((c) => c.trainerId === t.id);
    const scheduledSessions = mine.length;

    // Only what has already taken place counts as owed.
    const completed = mine.filter((c) => {
      const event = eventById.get(c.eventId);
      return event && !event.cancelled && event.startsAt <= asOf;
    });
    const completedSessions = completed.length;
    const earnedToDateCents =
      t.rateUnit === 'flat'
        ? // A flat season fee is not earned session by session, so there is
          // nothing sensible to prorate — treat it as due once anything has run.
          completedSessions > 0
          ? t.defaultRateCents
          : 0
        : completed.reduce((s, c) => s + c.amountCents, 0);

    const billedSessions =
      t.rateUnit === 'flat' ? 1 : Math.max(scheduledSessions, t.expectedSessions);
    const scheduledTotal = mine.reduce((s, c) => s + c.amountCents, 0);
    const forecastCents =
      t.rateUnit === 'flat'
        ? t.defaultRateCents
        : scheduledTotal + (billedSessions - scheduledSessions) * t.defaultRateCents;

    const myPayments = paid
      .filter((p) => p.trainerId === t.id)
      .sort((a, b) => a.paidOn.localeCompare(b.paidOn));
    const paidCents = myPayments.reduce((s, p) => s + p.amountCents, 0);

    return {
      trainerId: t.id,
      name: t.name,
      rateCents: t.defaultRateCents,
      completedSessions,
      scheduledSessions,
      billedSessions,
      earnedToDateCents,
      forecastCents,
      paidCents,
      owedCents: earnedToDateCents - paidCents,
      payments: myPayments.map((p) => ({
        id: p.id,
        paidOn: p.paidOn,
        amountCents: p.amountCents,
        method: p.method,
        note: p.note,
      })),
    };
  });
}

// Records a payment to a trainer and the matching withdrawal, so paying someone
// never needs two separate entries.
export async function payTrainer(input: {
  seasonId: number;
  trainerId: number;
  paidOn: string;
  amountCents: number;
  method: 'venmo' | 'cash' | 'zelle' | 'check' | 'other';
  note?: string | null;
}) {
  const [season] = await db.select().from(seasons).where(eq(seasons.id, input.seasonId));
  if (!season) throw new Error('season not found');
  const [trainer] = await db.select().from(trainers).where(eq(trainers.id, input.trainerId));
  if (!trainer) throw new Error('trainer not found');

  const account = await getOrCreateAccount(season.teamId);

  const [txn] = await db
    .insert(bankTransactions)
    .values({
      accountId: account.id,
      seasonId: input.seasonId,
      occurredOn: input.paidOn,
      description: `${trainer.name} — training`,
      // Money leaving the account.
      amountCents: -Math.abs(input.amountCents),
      kind: 'trainer_payment',
      note: input.note ?? null,
    })
    .returning();

  const [row] = await db
    .insert(trainerPayments)
    .values({
      seasonId: input.seasonId,
      trainerId: input.trainerId,
      paidOn: input.paidOn,
      amountCents: Math.abs(input.amountCents),
      method: input.method,
      note: input.note ?? null,
      bankTransactionId: txn.id,
    })
    .returning();

  return row;
}

// Removing a trainer payment takes its bank line with it, or the ledger would
// keep a withdrawal for money that is no longer recorded as paid.
export async function deleteTrainerPayment(id: number) {
  const [row] = await db.select().from(trainerPayments).where(eq(trainerPayments.id, id));
  if (!row) throw new Error('trainer payment not found');
  await db.delete(trainerPayments).where(eq(trainerPayments.id, id));
  if (row.bankTransactionId) {
    await db.delete(bankTransactions).where(eq(bankTransactions.id, row.bankTransactionId));
  }
}

// Undoing a transfer: clear the flag on the payments and drop the deposit line.
export async function undoTransfer(bankTransactionId: number) {
  const [txn] = await db
    .select()
    .from(bankTransactions)
    .where(eq(bankTransactions.id, bankTransactionId));
  if (!txn) throw new Error('bank transaction not found');
  if (txn.kind !== 'player_transfer') {
    throw new Error('only a player transfer can be undone this way');
  }
  const [account] = await db
    .select()
    .from(bankAccounts)
    .where(eq(bankAccounts.id, txn.accountId));
  if (account) {
    // Re-open every payment marked transferred on that date for this team. The
    // deposit is a batch, so this is the set it covered.
    const rows = await db
      .select({ id: payments.id })
      .from(payments)
      .innerJoin(seasons, eq(payments.seasonId, seasons.id))
      .where(and(eq(seasons.teamId, account.teamId), eq(payments.transferredOn, txn.occurredOn)));
    if (rows.length > 0) {
      await db
        .update(payments)
        .set({ transferredOn: null })
        .where(
          inArray(
            payments.id,
            rows.map((r) => r.id),
          ),
        );
    }
  }
  await db.delete(bankTransactions).where(eq(bankTransactions.id, bankTransactionId));
}

// Marks an expense as paid out of the team account on a given date, writing the
// matching withdrawal. Called again with a different date, it moves the existing
// bank line rather than writing a second one — the date is the field most likely
// to be corrected after the fact.
export async function markExpensePaid(expenseId: number, paidOn: string) {
  const [expense] = await db.select().from(expenses).where(eq(expenses.id, expenseId));
  if (!expense) throw new Error('expense not found');
  // Derived rows are deleted and rewritten on every recalculation, so a paid
  // flag on one would silently vanish and leave an orphaned withdrawal behind.
  // Tournaments carry their own paid state; everything else derived is an
  // aggregate over many events and is not a single payment anyway.
  if (expense.source === 'derived') {
    throw new Error(
      'this line is calculated from the schedule — mark the tournament paid, pay the trainer from the Bank page, or add a bank line directly',
    );
  }
  const [season] = await db.select().from(seasons).where(eq(seasons.id, expense.seasonId));
  if (!season) throw new Error('season not found');

  if (expense.bankTransactionId) {
    const [existing] = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, expense.bankTransactionId));
    if (existing) {
      await db
        .update(bankTransactions)
        .set({ occurredOn: paidOn, amountCents: -Math.abs(expense.amountCents) })
        .where(eq(bankTransactions.id, existing.id));
      const [row] = await db
        .update(expenses)
        .set({ paidOn })
        .where(eq(expenses.id, expenseId))
        .returning();
      return row;
    }
  }

  const account = await getOrCreateAccount(season.teamId);
  const [txn] = await db
    .insert(bankTransactions)
    .values({
      accountId: account.id,
      seasonId: expense.seasonId,
      occurredOn: paidOn,
      description: expense.label,
      amountCents: -Math.abs(expense.amountCents),
      kind: 'expense_payment',
    })
    .returning();

  const [row] = await db
    .update(expenses)
    .set({ paidOn, bankTransactionId: txn.id })
    .where(eq(expenses.id, expenseId))
    .returning();
  return row;
}

export async function markExpenseUnpaid(expenseId: number) {
  const [expense] = await db.select().from(expenses).where(eq(expenses.id, expenseId));
  if (!expense) throw new Error('expense not found');
  if (expense.bankTransactionId) {
    await db.delete(bankTransactions).where(eq(bankTransactions.id, expense.bankTransactionId));
  }
  const [row] = await db
    .update(expenses)
    .set({ paidOn: null, bankTransactionId: null })
    .where(eq(expenses.id, expenseId))
    .returning();
  return row;
}

// Same as markExpensePaid, for a tournament registration fee.
export async function markTournamentPaid(tournamentId: number, paidOn: string) {
  const [t] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId));
  if (!t) throw new Error('tournament not found');
  const [season] = await db.select().from(seasons).where(eq(seasons.id, t.seasonId));
  if (!season) throw new Error('season not found');

  if (t.bankTransactionId) {
    const [existing] = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, t.bankTransactionId));
    if (existing) {
      await db
        .update(bankTransactions)
        .set({ occurredOn: paidOn, amountCents: -Math.abs(t.registrationCents) })
        .where(eq(bankTransactions.id, existing.id));
      const [row] = await db
        .update(tournaments)
        .set({ paidOn })
        .where(eq(tournaments.id, tournamentId))
        .returning();
      return row;
    }
  }

  const account = await getOrCreateAccount(season.teamId);
  const [txn] = await db
    .insert(bankTransactions)
    .values({
      accountId: account.id,
      seasonId: t.seasonId,
      occurredOn: paidOn,
      description: `${t.name} — registration`,
      amountCents: -Math.abs(t.registrationCents),
      kind: 'expense_payment',
    })
    .returning();

  const [row] = await db
    .update(tournaments)
    .set({ paidOn, bankTransactionId: txn.id })
    .where(eq(tournaments.id, tournamentId))
    .returning();
  return row;
}

export async function markTournamentUnpaid(tournamentId: number) {
  const [t] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId));
  if (!t) throw new Error('tournament not found');
  if (t.bankTransactionId) {
    await db.delete(bankTransactions).where(eq(bankTransactions.id, t.bankTransactionId));
  }
  const [row] = await db
    .update(tournaments)
    .set({ paidOn: null, bankTransactionId: null })
    .where(eq(tournaments.id, tournamentId))
    .returning();
  return row;
}

// Payments received from parents that have not yet reached the team account.
export async function untransferredPayments(teamId: number) {
  return db
    .select({
      id: payments.id,
      seasonId: payments.seasonId,
      playerName: players.name,
      paidAt: payments.paidAt,
      amountCents: payments.amountCents,
      method: payments.method,
      note: payments.note,
    })
    .from(payments)
    .innerJoin(seasons, eq(payments.seasonId, seasons.id))
    .innerJoin(players, eq(payments.playerId, players.id))
    .where(and(eq(seasons.teamId, teamId), isNull(payments.transferredOn)))
    .orderBy(asc(payments.paidAt));
}
