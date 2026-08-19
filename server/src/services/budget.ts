import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  costRules,
  credits,
  eventCharges,
  events,
  expenses,
  payments,
  playerCredits,
  players,
  seasonInstallments,
  seasonPlayers,
  seasons,
  tournaments,
  trainers,
} from '../db/schema.js';
import { allocateInstalments, quotedShareCents, splitEvenly } from './money.js';
import { expectedSessionsFor } from './trainers.js';

// This module is the only place the spreadsheet's arithmetic lives. Screens,
// exports and the rollover all read from computeSeasonBudget — nothing
// recomputes a total inline, because two implementations of the same sum is
// how a budget app starts disagreeing with itself.
//
//   derived charges (ref fee × games, trainer rate × sessions)
//     → expenses grouped by category
//     → total expenses − total credits = net owed by the team
//     → ÷ roster size = per-player dues
//     → − payments received − balance carried in = what each player still owes

export type CategoryTotal = {
  category: string;
  amountCents: number;
  lines: {
    id: number;
    label: string;
    amountCents: number;
    source: string;
    paidOn?: string | null;
  }[];
};

export type PlayerBalance = {
  playerId: number;
  seasonPlayerId: number;
  name: string;
  jerseyNumber: string | null;
  parentEmail: string | null;
  venmoHandle: string | null;
  // What this player is billed before payments: their share (or override),
  // adjusted by anything carried in from last season.
  duesCents: number;
  shareCents: number;
  carriedBalanceCents: number;
  // Fundraising this player raised themselves. Reduces their bill alone.
  raisedCents: number;
  credits: { id: number; label: string; amountCents: number; receivedOn: string | null }[];
  hasOverride: boolean;
  paidCents: number;
  // Positive = still owes. Negative = overpaid and is owed a refund/credit.
  balanceCents: number;
  // This player's share of each instalment, in plan order. Amounts are their
  // own — a player on an override or carrying a balance owes different figures
  // to everyone else against the same plan.
  installments: {
    id: number;
    seq: number;
    label: string | null;
    dueDate: string | null;
    amountCents: number;
    paid: boolean;
  }[];
  payments: {
    id: number;
    paidAt: string;
    amountCents: number;
    method: string;
    installment: string;
    note: string | null;
    transferredOn: string | null;
  }[];
};

export type SeasonBudget = {
  seasonId: number;
  rosterCount: number;
  expensesByCategory: CategoryTotal[];
  totalExpensesCents: number;
  creditsByKind: CategoryTotal[];
  totalCreditsCents: number;
  netDueCents: number;
  // The single number quoted to parents. Rounded up; the exact per-player
  // splits in `playerBalances` are what actually sum to netDueCents.
  quotedPerPlayerCents: number;
  // Fundraising attributed to individual players. Money the team has received,
  // so it reduces what is left to collect in cash without being split evenly.
  totalPlayerRaisedCents: number;
  totalCollectedCents: number;
  totalOutstandingCents: number;
  playerBalances: PlayerBalance[];
};

// Rewrites the 'derived' expense rows for a season from its cost rules and the
// events on the calendar. Called after a calendar sync, a rule edit, or an
// event-charge override — everything else just reads the resulting rows.
//
// Overridden charges keep their amount; cancelled events charge nothing.
export async function recalculateDerivedExpenses(seasonId: number): Promise<void> {
  const rules = await db
    .select()
    .from(costRules)
    .where(and(eq(costRules.seasonId, seasonId), eq(costRules.active, true)));

  const seasonEvents = await db.select().from(events).where(eq(events.seasonId, seasonId));
  const liveEvents = seasonEvents.filter((e) => !e.cancelled);

  const eventIds = seasonEvents.map((e) => e.id);
  const existingCharges = eventIds.length
    ? await db.select().from(eventCharges).where(inArray(eventCharges.eventId, eventIds))
    : [];
  // Two maps because a charge is keyed either by the rule that produced it or by
  // the trainer whose rate produced it. Entries are removed as they are matched;
  // whatever is left at the end is stale and gets deleted.
  const chargeByKey = new Map(
    existingCharges.filter((c) => c.ruleId !== null).map((c) => [`${c.eventId}:${c.ruleId}`, c]),
  );
  const trainerChargeByKey = new Map(
    existingCharges
      .filter((c) => c.trainerId !== null)
      .map((c) => [`${c.eventId}:t${c.trainerId}`, c]),
  );

  for (const rule of rules) {
    // A flat rule is a season-level amount (a package price), not something
    // multiplied by attendance — it produces one expense line and no charges.
    if (rule.unit === 'flat') continue;

    const matching = liveEvents.filter((e) => {
      if (e.type !== rule.eventType) return false;
      // A trainer-scoped rule only applies to that trainer's sessions.
      if (rule.trainerId !== null && e.trainerId !== rule.trainerId) return false;
      return true;
    });

    for (const event of matching) {
      const key = `${event.id}:${rule.id}`;
      const existing = chargeByKey.get(key);
      if (existing) {
        // Never clobber a hand-edited amount.
        if (!existing.overridden && existing.amountCents !== rule.amountCents) {
          await db
            .update(eventCharges)
            .set({ amountCents: rule.amountCents })
            .where(eq(eventCharges.id, existing.id));
        }
        chargeByKey.delete(key);
      } else {
        await db.insert(eventCharges).values({
          eventId: event.id,
          ruleId: rule.id,
          amountCents: rule.amountCents,
        });
      }
    }
  }

  // Trainer rates. A trainer attached to an event gets paid for it, whatever
  // the event type — that is the whole point of attaching them, and expecting
  // the treasurer to also write a matching cost rule made the rate field on the
  // Settings page a lie.
  //
  // Skipped when a trainer-scoped rule already covers the event, so a rule
  // written for "Bob's practices" does not charge Bob twice.
  // Scoped to this season's team. An expected-session count bills even with no
  // events attached, so pulling every trainer in the database would put another
  // team's coach on this team's budget.
  const [thisSeason] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  if (!thisSeason) throw new Error(`season ${seasonId} not found`);
  const trainerById = new Map(
    (await db.select().from(trainers).where(eq(trainers.teamId, thisSeason.teamId))).map(
      (t) => [t.id, t] as const,
    ),
  );
  for (const event of liveEvents) {
    if (event.trainerId === null) continue;
    const trainer = trainerById.get(event.trainerId);
    if (!trainer || trainer.rateUnit === 'flat' || trainer.defaultRateCents === 0) continue;

    const coveredByRule = rules.some(
      (r) => r.unit !== 'flat' && r.trainerId === event.trainerId && r.eventType === event.type,
    );
    if (coveredByRule) continue;

    const key = `${event.id}:t${event.trainerId}`;
    const existing = trainerChargeByKey.get(key);
    if (existing) {
      if (!existing.overridden && existing.amountCents !== trainer.defaultRateCents) {
        await db
          .update(eventCharges)
          .set({ amountCents: trainer.defaultRateCents })
          .where(eq(eventCharges.id, existing.id));
      }
      trainerChargeByKey.delete(key);
    } else {
      await db.insert(eventCharges).values({
        eventId: event.id,
        trainerId: event.trainerId,
        amountCents: trainer.defaultRateCents,
      });
    }
  }

  // Anything still in either map no longer matches — the event was cancelled,
  // retyped, or reassigned to another trainer. Drop those charges unless a
  // human deliberately overrode them.
  for (const stale of [...chargeByKey.values(), ...trainerChargeByKey.values()]) {
    if (stale.overridden) continue;
    await db.delete(eventCharges).where(eq(eventCharges.id, stale.id));
  }

  // Roll the charges up into one derived expense line per rule.
  const freshCharges = eventIds.length
    ? await db.select().from(eventCharges).where(inArray(eventCharges.eventId, eventIds))
    : [];

  await db
    .delete(expenses)
    .where(and(eq(expenses.seasonId, seasonId), eq(expenses.source, 'derived')));

  for (const rule of rules) {
    if (rule.unit === 'flat') {
      await db.insert(expenses).values({
        seasonId,
        category: rule.kind === 'ref_fee' ? 'ref_fees' : 'training',
        label: rule.label,
        amountCents: rule.amountCents,
        source: 'derived',
        ruleId: rule.id,
      });
      continue;
    }

    const ruleCharges = freshCharges.filter((c) => c.ruleId === rule.id);
    // Bill the estimate until the calendar catches up with it. Charges exist
    // only for events that are really scheduled, so the shortfall is added as a
    // flat top-up rather than as phantom charges against events that don't
    // exist yet.
    const scheduled = ruleCharges.length;
    const billed = Math.max(scheduled, rule.expectedCount);
    if (billed === 0) continue;

    const scheduledTotal = ruleCharges.reduce((sum, c) => sum + c.amountCents, 0);
    const total = scheduledTotal + (billed - scheduled) * rule.amountCents;
    const label =
      billed > scheduled
        ? `${rule.label} (${billed} expected × ${(rule.amountCents / 100).toFixed(2)}, ${scheduled} scheduled)`
        : `${rule.label} (${billed} × ${(rule.amountCents / 100).toFixed(2)})`;
    await db.insert(expenses).values({
      seasonId,
      category: rule.kind === 'ref_fee' ? 'ref_fees' : 'training',
      label,
      amountCents: total,
      source: 'derived',
      ruleId: rule.id,
    });
  }

  // Tournaments: one derived line each, so the budget page shows them by name
  // the way the spreadsheet did.
  const tournamentRows = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.seasonId, seasonId));
  for (const t of tournamentRows) {
    if (t.registrationCents === 0) continue;
    await db.insert(expenses).values({
      seasonId,
      category: 'tournaments',
      label: t.estimated ? `${t.name} (estimated)` : t.name,
      amountCents: t.registrationCents,
      source: 'derived',
      incurredOn: t.startDate,
    });
  }

  // One training line per trainer, covering every event they were attached to
  // that no rule already priced — topped up to their expected session count the
  // same way rules are.
  for (const [trainerId, trainer] of trainerById) {
    const mine = freshCharges.filter((c) => c.trainerId === trainerId);
    const scheduled = mine.length;
    const billed = Math.max(scheduled, expectedSessionsFor(trainer));
    if (billed === 0) continue;

    const scheduledTotal = mine.reduce((sum, c) => sum + c.amountCents, 0);
    const total = scheduledTotal + (billed - scheduled) * trainer.defaultRateCents;
    // An unpaid volunteer coach still gets attached to events; they just should
    // not produce a $0 line cluttering the budget.
    if (total === 0) continue;
    const rate = (trainer.defaultRateCents / 100).toFixed(2);
    await db.insert(expenses).values({
      seasonId,
      category: 'training',
      label:
        billed > scheduled
          ? `${trainer.name} (${billed} expected × ${rate}, ${scheduled} scheduled)`
          : `${trainer.name} (${billed} × ${rate})`,
      amountCents: total,
      source: 'derived',
    });
  }
}

export async function computeSeasonBudget(seasonId: number): Promise<SeasonBudget> {
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  if (!season) throw new Error(`season ${seasonId} not found`);

  const expenseRows = await db.select().from(expenses).where(eq(expenses.seasonId, seasonId));
  const creditRows = await db.select().from(credits).where(eq(credits.seasonId, seasonId));

  const roster = await db
    .select({
      seasonPlayerId: seasonPlayers.id,
      playerId: players.id,
      name: players.name,
      parentEmail: players.parentEmail,
      venmoHandle: players.venmoHandle,
      jerseyNumber: seasonPlayers.jerseyNumber,
      duesOverrideCents: seasonPlayers.duesOverrideCents,
      carriedBalanceCents: seasonPlayers.carriedBalanceCents,
    })
    .from(seasonPlayers)
    .innerJoin(players, eq(seasonPlayers.playerId, players.id))
    .where(eq(seasonPlayers.seasonId, seasonId))
    .orderBy(players.name);

  const paymentRows = await db.select().from(payments).where(eq(payments.seasonId, seasonId));
  // The payment plan, in order. No rows at all means the whole amount in one
  // go, which is what a season with no plan has always meant.
  const planRows = (
    await db.select().from(seasonInstallments).where(eq(seasonInstallments.seasonId, seasonId))
  ).sort((a, b) => a.seq - b.seq);
  const playerCreditRows = await db
    .select()
    .from(playerCredits)
    .where(eq(playerCredits.seasonId, seasonId));

  const groupBy = <T extends { amountCents: number; label: string; id: number }>(
    rows: T[],
    keyOf: (row: T) => string,
    sourceOf: (row: T) => string,
    paidOf: (row: T) => string | null = () => null,
  ): CategoryTotal[] => {
    const map = new Map<string, CategoryTotal>();
    for (const row of rows) {
      const key = keyOf(row);
      const entry = map.get(key) ?? { category: key, amountCents: 0, lines: [] };
      entry.amountCents += row.amountCents;
      entry.lines.push({
        id: row.id,
        label: row.label,
        amountCents: row.amountCents,
        source: sourceOf(row),
        paidOn: paidOf(row),
      });
      map.set(key, entry);
    }
    return [...map.values()];
  };

  const expensesByCategory = groupBy(
    expenseRows,
    (r) => r.category,
    (r) => r.source,
    (r) => r.paidOn,
  );
  const creditsByKind = groupBy(
    creditRows,
    (r) => r.kind,
    () => 'manual',
  );

  const totalExpensesCents = expenseRows.reduce((s, r) => s + r.amountCents, 0);
  const totalCreditsCents = creditRows.reduce((s, r) => s + r.amountCents, 0);
  const netDueCents = totalExpensesCents - totalCreditsCents;

  // Players on a fixed override are billed their override; the remaining cost
  // is split across everyone else. Without this, a scholarship player would
  // shift cost onto nobody and the team would come up short.
  const overrideRoster = roster.filter((r) => r.duesOverrideCents !== null);
  const splitRoster = roster.filter((r) => r.duesOverrideCents === null);
  const overrideTotal = overrideRoster.reduce((s, r) => s + (r.duesOverrideCents ?? 0), 0);
  const shares = splitEvenly(netDueCents - overrideTotal, splitRoster.length);

  const shareByPlayer = new Map<number, number>();
  splitRoster.forEach((r, i) => shareByPlayer.set(r.playerId, shares[i] ?? 0));
  overrideRoster.forEach((r) => shareByPlayer.set(r.playerId, r.duesOverrideCents ?? 0));

  const playerBalances: PlayerBalance[] = roster.map((r) => {
    const shareCents = shareByPlayer.get(r.playerId) ?? 0;
    const myCredits = playerCreditRows
      .filter((c) => c.playerId === r.playerId)
      .sort((a, b) => (a.receivedOn ?? '').localeCompare(b.receivedOn ?? ''));
    const raisedCents = myCredits.reduce((s, c) => s + c.amountCents, 0);
    // A positive carried balance is money the player was owed, so it reduces
    // this season's bill. So does anything they raised themselves — the team
    // already has that cash, so it comes off what this family still has to pay
    // rather than being shared across the roster.
    const duesCents = shareCents - r.carriedBalanceCents - raisedCents;
    const mine = paymentRows
      .filter((p) => p.playerId === r.playerId)
      .sort((a, b) => a.paidAt.localeCompare(b.paidAt));
    const paidCents = mine.reduce((s, p) => s + p.amountCents, 0);

    const parts = allocateInstalments(
      duesCents,
      planRows.map((i) => i.amountCents),
    );
    const settled = new Set(mine.map((p) => p.installmentId).filter((id): id is number => id !== null));

    return {
      playerId: r.playerId,
      seasonPlayerId: r.seasonPlayerId,
      name: r.name,
      jerseyNumber: r.jerseyNumber,
      parentEmail: r.parentEmail,
      venmoHandle: r.venmoHandle,
      duesCents,
      shareCents,
      carriedBalanceCents: r.carriedBalanceCents,
      raisedCents,
      credits: myCredits.map((c) => ({
        id: c.id,
        label: c.label,
        amountCents: c.amountCents,
        receivedOn: c.receivedOn,
      })),
      hasOverride: r.duesOverrideCents !== null,
      paidCents,
      balanceCents: duesCents - paidCents,
      installments: planRows.map((row, i) => ({
        id: row.id,
        seq: row.seq,
        label: row.label,
        dueDate: row.dueDate,
        amountCents: parts[i] ?? 0,
        paid: settled.has(row.id),
      })),
      payments: mine.map((p) => ({
        id: p.id,
        paidAt: p.paidAt,
        amountCents: p.amountCents,
        method: p.method,
        installment: p.installment,
        note: p.note,
        transferredOn: p.transferredOn,
      })),
    };
  });

  return {
    seasonId,
    rosterCount: roster.length,
    expensesByCategory,
    totalExpensesCents,
    creditsByKind,
    totalCreditsCents,
    netDueCents,
    quotedPerPlayerCents: quotedShareCents(netDueCents, roster.length),
    totalPlayerRaisedCents: playerCreditRows.reduce((s, c) => s + c.amountCents, 0),
    totalCollectedCents: paymentRows.reduce((s, p) => s + p.amountCents, 0),
    totalOutstandingCents: playerBalances.reduce((s, p) => s + Math.max(0, p.balanceCents), 0),
    playerBalances,
  };
}

// Ticking an instalment on the roster records exactly that one, and unticking
// removes it again. Keyed on the instalment row so the toggle never has to
// guess which of a player's payment rows it meant — which it would get wrong
// the moment someone paid in two parts.
export async function setInstallmentPaid(input: {
  seasonId: number;
  playerId: number;
  installmentId: number;
  paid: boolean;
  paidAt?: string;
}): Promise<{ ok: true }> {
  const existing = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.seasonId, input.seasonId),
        eq(payments.playerId, input.playerId),
        eq(payments.installmentId, input.installmentId),
      ),
    );

  if (!input.paid) {
    for (const row of existing) {
      await db.delete(payments).where(eq(payments.id, row.id));
    }
    return { ok: true };
  }

  // Already recorded — ticking again must not add a second payment.
  if (existing.length > 0) return { ok: true };

  const budget = await computeSeasonBudget(input.seasonId);
  const player = budget.playerBalances.find((p) => p.playerId === input.playerId);
  if (!player) throw new Error('player is not on this season roster');

  const row = player.installments.find((i) => i.id === input.installmentId);
  if (!row) throw new Error('that instalment is not part of this season');
  if (row.amountCents <= 0) {
    throw new Error(
      'that instalment is zero for this player — record the amount on their page instead',
    );
  }

  await db.insert(payments).values({
    seasonId: input.seasonId,
    playerId: input.playerId,
    paidAt: input.paidAt ?? new Date().toISOString().slice(0, 10),
    amountCents: row.amountCents,
    method: 'venmo',
    installmentId: row.id,
    // The legacy enum still has a NOT NULL default; keep it meaningful for the
    // first and last instalment so old exports and databases stay readable.
    installment: row.seq === 1 ? 'first' : row.seq === player.installments.length ? 'final' : 'other',
    note: row.label?.trim() ? row.label.trim() : `Payment ${row.seq}`,
  });

  return { ok: true };
}

// Convenience for the schedule screen: every event with what it costs and who
// is training it.
export async function listEventsWithCosts(seasonId: number) {
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      location: events.location,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      type: events.type,
      typeConfirmed: events.typeConfirmed,
      cancelled: events.cancelled,
      source: events.source,
      trainerId: events.trainerId,
      trainerName: trainers.name,
    })
    .from(events)
    .leftJoin(trainers, eq(events.trainerId, trainers.id))
    .where(eq(events.seasonId, seasonId))
    .orderBy(events.startsAt);

  const ids = rows.map((r) => r.id);
  const charges = ids.length
    ? await db.select().from(eventCharges).where(inArray(eventCharges.eventId, ids))
    : [];

  return rows.map((r) => {
    const mine = charges.filter((c) => c.eventId === r.id);
    return {
      ...r,
      charges: mine,
      costCents: mine.reduce((s, c) => s + c.amountCents, 0),
    };
  });
}
