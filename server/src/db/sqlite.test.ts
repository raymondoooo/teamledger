import Database from 'better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from './schema.js';

// These pin the storage-engine behaviour the rest of the app assumes: that
// .returning() hands back rows, that a cascade actually cascades, that a
// timestamp column round-trips as a Date and a date column as a plain string,
// and that the two money-critical CHECK constraints are real. None of it is
// obvious from the schema, and all of it changed when the database did.

const { teams, seasons, players, seasonPlayers, expenses, costRules, events } = schema;

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(() => {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './migrations' });
});

async function makeSeason() {
  const [team] = await db.insert(teams).values({ name: 'Rockets' }).returning();
  const [season] = await db
    .insert(seasons)
    .values({ teamId: team.id, term: 'spring', year: 2026 })
    .returning();
  return { team, season };
}

describe('returning()', () => {
  it('hands back the inserted row, including server-side defaults', async () => {
    const rows = await db.insert(teams).values({ name: 'Rockets' }).returning();

    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(1);
    // The routes all destructure `const [x] = await …returning()`.
    const [team] = rows;
    expect(team.id).toBeGreaterThan(0);
    expect(team.name).toBe('Rockets');
    // Defaulted by the database, so its presence proves the row came back from
    // SQLite rather than being echoed from the values we passed in.
    expect(team.sport).toBe('soccer');
  });

  it('hands back the updated row on update', async () => {
    const [team] = await db.insert(teams).values({ name: 'Rockets' }).returning();
    const [updated] = await db
      .update(teams)
      .set({ club: 'Eastside' })
      .where(eq(teams.id, team.id))
      .returning();

    expect(updated.club).toBe('Eastside');
    expect(updated.name).toBe('Rockets');
  });
});

describe('cascade delete', () => {
  it('removes dependent rows when a parent goes', async () => {
    const { team, season } = await makeSeason();
    const [player] = await db.insert(players).values({ teamId: team.id, name: 'Ada' }).returning();
    await db.insert(seasonPlayers).values({ seasonId: season.id, playerId: player.id });
    await db
      .insert(expenses)
      .values({ seasonId: season.id, category: 'misc', label: 'Cones', amountCents: 1500 });

    await db.delete(seasons).where(eq(seasons.id, season.id));

    // Without `pragma foreign_keys = ON` these both silently survive as orphans.
    expect(await db.select().from(seasonPlayers)).toHaveLength(0);
    expect(await db.select().from(expenses)).toHaveLength(0);
    // The player belongs to the team, not the season — rollover depends on it
    // outliving the season it was rostered in.
    expect(await db.select().from(players)).toHaveLength(1);
  });

  it('cascades from the team all the way down', async () => {
    const { team, season } = await makeSeason();
    await db.insert(players).values({ teamId: team.id, name: 'Ada' });

    await db.delete(teams).where(eq(teams.id, team.id));

    expect(await db.select().from(seasons)).toHaveLength(0);
    expect(await db.select().from(players)).toHaveLength(0);
    void season;
  });
});

describe('column types survive the round trip', () => {
  it('returns timestamps as Date and dates as plain strings', async () => {
    const { team } = await makeSeason();
    const [season] = await db
      .insert(seasons)
      .values({ teamId: team.id, term: 'fall', year: 2026, startDate: '2026-09-01' })
      .returning();

    // node-postgres handed timestamptz back as a Date; mode: 'timestamp' does
    // too, which is why nothing above this layer had to change.
    expect(season.createdAt).toBeInstanceOf(Date);
    // A plain calendar date. If this ever comes back as a Date it has been
    // timezone-shifted, and '2026-09-01' can render as August 31st.
    expect(season.startDate).toBe('2026-09-01');
  });

  it('returns booleans as booleans, not 0/1', async () => {
    const { season } = await makeSeason();
    const [event] = await db
      .insert(events)
      .values({ seasonId: season.id, title: 'Game vs Hawks', startsAt: new Date(), type: 'game' })
      .returning();

    expect(event.typeConfirmed).toBe(false);
    expect(event.cancelled).toBe(false);
  });
});

// text({ enum }) is a TypeScript-only constraint, so these two columns — the
// ones where a bad value moves money rather than just looking wrong — carry a
// real CHECK as well. Drizzle wraps driver errors, so the constraint name is on
// the cause rather than the message.
function causeOf(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    return (err as { cause?: Error }).cause?.message ?? String(err);
  }
  throw new Error('expected the insert to be refused, but it succeeded');
}

describe('CHECK constraints', () => {
  it('refuses an expense source outside manual/derived', async () => {
    const { season } = await makeSeason();

    expect(
      causeOf(() =>
        db.run(
          sql`insert into expenses (season_id, category, label, amount_cents, source)
              values (${season.id}, 'misc', 'Cones', 1500, 'drived')`,
        ),
      ),
    ).toMatch('CHECK constraint failed: expenses_source_check');
  });

  it('refuses a cost rule kind outside ref_fee/training', async () => {
    const { season } = await makeSeason();

    expect(
      causeOf(() =>
        db.run(
          sql`insert into cost_rules (season_id, kind, label, event_type, amount_cents)
              values (${season.id}, 'reffee', 'Refs', 'game', 7500)`,
        ),
      ),
    ).toMatch('CHECK constraint failed: cost_rules_kind_check');
  });

  it('still accepts the valid values', async () => {
    const { season } = await makeSeason();
    const [rule] = await db
      .insert(costRules)
      .values({
        seasonId: season.id,
        kind: 'ref_fee',
        label: 'Refs',
        eventType: 'game',
        amountCents: 7500,
      })
      .returning();

    expect(rule.kind).toBe('ref_fee');
  });
});
