import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { costRules, credits, seasonPlayers, seasons } from '../db/schema.js';
import { computeSeasonBudget } from './budget.js';

// Closing a season and opening the next one is the step the spreadsheet made
// painful: a new copy of the file, retyped roster, and the leftover money from
// last time reduced to a single "Money left in team account" cell that nobody
// could trace back to who overpaid.
//
// Here it is one operation. Every player's ending balance follows them, and the
// team's leftover cash arrives in the new season as a credit line.

export type RolloverOptions = {
  seasonId: number;
  term: 'fall' | 'spring' | 'summer' | 'winter';
  year: number;
  startDate?: string | null;
  endDate?: string | null;
  // Carry each player's over/underpayment into the new season's dues. Off means
  // everyone starts square and you settle up out of band.
  carryPlayerBalances: boolean;
  // Carry money still sitting in the team account into the new season as a
  // credit, the way the old sheet's top-left "Credits" block did.
  carryTeamFunds: boolean;
  // Copy trainer rates and ref-fee rules so the new season can price its
  // calendar immediately.
  copyCostRules: boolean;
  // Roster members to carry. Omit to carry everyone from the closing season —
  // pass a list to drop players who aged out or left the club.
  playerIds?: number[];
};

export type RolloverResult = {
  newSeasonId: number;
  playersCarried: number;
  teamFundsCarriedCents: number;
  costRulesCopied: number;
};

export async function rolloverSeason(opts: RolloverOptions): Promise<RolloverResult> {
  const [current] = await db.select().from(seasons).where(eq(seasons.id, opts.seasonId));
  if (!current) throw new Error(`season ${opts.seasonId} not found`);

  const budget = await computeSeasonBudget(opts.seasonId);

  const existing = await db
    .select()
    .from(seasons)
    .where(
      and(
        eq(seasons.teamId, current.teamId),
        eq(seasons.term, opts.term),
        eq(seasons.year, opts.year),
      ),
    );
  if (existing.length > 0) {
    throw new Error(`a ${opts.term} ${opts.year} season already exists for this team`);
  }

  const [next] = await db
    .insert(seasons)
    .values({
      teamId: current.teamId,
      term: opts.term,
      year: opts.year,
      startDate: opts.startDate ?? null,
      endDate: opts.endDate ?? null,
      status: 'active',
    })
    .returning();

  const carryAll = opts.playerIds === undefined;
  const wanted = new Set(opts.playerIds ?? []);
  const carried = budget.playerBalances.filter((p) => carryAll || wanted.has(p.playerId));

  for (const p of carried) {
    // balanceCents is what they still owe, so a player who overpaid has a
    // negative balance. Flip the sign: a positive carried balance is money the
    // team holds on their behalf, which budget.ts subtracts from next season's
    // bill.
    const carriedBalanceCents = opts.carryPlayerBalances ? -p.balanceCents : 0;
    await db.insert(seasonPlayers).values({
      seasonId: next.id,
      playerId: p.playerId,
      jerseyNumber: p.jerseyNumber,
      carriedBalanceCents,
    });
  }

  let teamFundsCarriedCents = 0;
  if (opts.carryTeamFunds) {
    // What the team actually holds minus what it owes out. If players' own
    // balances are following them, their share of that cash is already
    // accounted for on their line — carrying it again would double-count it.
    const collected = budget.totalCollectedCents;
    const spent = budget.totalExpensesCents - budget.totalCreditsCents;
    const leftover = collected - spent;
    const alreadyOnPlayerLines = opts.carryPlayerBalances
      ? carried.reduce((s, p) => s + -p.balanceCents, 0)
      : 0;
    teamFundsCarriedCents = leftover - alreadyOnPlayerLines;

    if (teamFundsCarriedCents !== 0) {
      await db.insert(credits).values({
        seasonId: next.id,
        kind: 'credit',
        label: `Money left in team account (${current.term} ${current.year})`,
        amountCents: teamFundsCarriedCents,
      });
    }
  }

  let costRulesCopied = 0;
  if (opts.copyCostRules) {
    const rules = await db
      .select()
      .from(costRules)
      .where(and(eq(costRules.seasonId, opts.seasonId), eq(costRules.active, true)));
    for (const rule of rules) {
      await db.insert(costRules).values({
        seasonId: next.id,
        kind: rule.kind,
        label: rule.label,
        eventType: rule.eventType,
        trainerId: rule.trainerId,
        amountCents: rule.amountCents,
        unit: rule.unit,
        // Last season's count is the best available estimate for the new one,
        // and it makes the new season budget immediately rather than reading $0
        // until its calendar fills in.
        expectedCount: rule.expectedCount,
      });
      costRulesCopied += 1;
    }
  }

  await db
    .update(seasons)
    .set({ status: 'closed', closedAt: new Date() })
    .where(eq(seasons.id, opts.seasonId));

  return {
    newSeasonId: next.id,
    playersCarried: carried.length,
    teamFundsCarriedCents,
    costRulesCopied,
  };
}
