import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  adminExists,
  clearSession,
  createAdmin,
  issueSession,
  requireAdmin,
  verifyCredentials,
} from '../auth.js';
import { loginRateLimit } from '../config.js';
import { db } from '../db/index.js';
import {
  bankAccounts,
  bankTransactions,
  costRules,
  credits,
  eventCharges,
  events,
  expenses,
  icalFeeds,
  payments,
  playerCredits,
  players,
  seasonPlayers,
  seasons,
  teams,
  tournaments,
  trainers,
} from '../db/schema.js';
import {
  computeSeasonBudget,
  listEventsWithCosts,
  recalculateDerivedExpenses,
  setInstallmentPaid,
} from '../services/budget.js';
import {
  balancesCsv,
  bankLedgerCsv,
  budgetCsv,
  budgetPdf,
  budgetSheetPdf,
  ledgerCsv,
  playerStatementPdf,
  rosterCsv,
} from '../services/exports.js';
import {
  deleteTrainerPayment,
  getLedger,
  markExpensePaid,
  markExpenseUnpaid,
  markTournamentPaid,
  markTournamentUnpaid,
  getOrCreateAccount,
  payTrainer,
  trainerLedger,
  transferPayments,
  undoTransfer,
  untransferredPayments,
} from '../services/bank.js';
import { rolloverSeason } from '../services/rollover.js';
import { primaryTrainerFor } from '../services/trainers.js';
import { syncFeed } from '../services/sync.js';

export const api = Router();

// Wraps an async handler so a rejected promise becomes a 500 instead of an
// unhandled rejection that takes the process down.
const handle =
  <T>(fn: (req: any, res: any) => Promise<T>) =>
  (req: any, res: any) =>
    fn(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[api] ${req.method} ${req.path}: ${message}`);
      if (!res.headersSent) res.status(400).json({ error: message });
    });

const money = z.number().int();
const idParam = z.coerce.number().int().positive();

// --- health & setup -------------------------------------------------------

// The only endpoints where guessing gets you something.
//
// skipSuccessfulRequests is the important one: this limits *failed* attempts,
// not use of the endpoint. Counting successes meant the tenth correct login in
// a window was refused — and with TRUST_PROXY off every client shares a single
// bucket, so signing in from a phone and a laptop could lock the treasurer out
// of their own instance with the right password.
//
// `validate: false` silences the library's proxy warnings; whether
// X-Forwarded-For is trusted is decided once, deliberately, by TRUST_PROXY.
const credentialLimiter = rateLimit({
  windowMs: loginRateLimit.windowMs,
  limit: loginRateLimit.max,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  message: { error: 'too many failed attempts — wait a few minutes and try again' },
});

// Deliberately queries the database. A container that cannot read its own
// datastore — a corrupt file, a data directory that vanished from under a bind
// mount — is not healthy, but a handler that just returns a literal would report
// that it is, and an orchestrator would keep routing traffic to it.
api.get('/health', async (_req, res) => {
  try {
    db.get(sql`select 1`);
    res.json({ ok: true, buildId: process.env.BUILD_ID ?? 'unknown', db: 'up' });
  } catch (err) {
    console.error('[health] database unreachable:', err instanceof Error ? err.message : err);
    res.status(503).json({ ok: false, buildId: process.env.BUILD_ID ?? 'unknown', db: 'down' });
  }
});

// Drives the first-run screen: a brand-new container has no admin, so the web
// app shows setup instead of a login form.
api.get(
  '/setup/status',
  handle(async (_req, res) => {
    res.json({ configured: await adminExists() });
  }),
);

api.post(
  '/setup',
  credentialLimiter,
  handle(async (req, res) => {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(8) })
      .parse(req.body);
    const admin = await createAdmin(body.email, body.password);
    issueSession(res, admin);
    res.json({ ok: true, email: admin.email });
  }),
);

// --- session --------------------------------------------------------------

api.post(
  '/auth/login',
  credentialLimiter,
  handle(async (req, res) => {
    const body = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
    const admin = await verifyCredentials(body.email, body.password);
    if (!admin) return res.status(401).json({ error: 'invalid email or password' });
    issueSession(res, admin);
    res.json({ ok: true, email: admin.email });
  }),
);

api.post('/auth/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

api.get('/auth/me', requireAdmin, (req, res) => {
  res.json({ admin: (req as any).admin });
});

// Everything past this point requires the treasurer to be signed in.
api.use(requireAdmin);

// --- teams ----------------------------------------------------------------

api.get(
  '/teams',
  handle(async (_req, res) => {
    res.json(await db.select().from(teams).orderBy(teams.name));
  }),
);

api.post(
  '/teams',
  handle(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(1),
        club: z.string().nullish(),
        ageGroup: z.string().nullish(),
        sport: z.string().default('soccer'),
        venmoHandle: z.string().nullish(),
      })
      .parse(req.body);
    const [team] = await db.insert(teams).values(body).returning();
    res.json(team);
  }),
);

api.patch(
  '/teams/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        club: z.string().nullish(),
        ageGroup: z.string().nullish(),
        sport: z.string().optional(),
        venmoHandle: z.string().nullish(),
      })
      .parse(req.body);
    const [team] = await db.update(teams).set(body).where(eq(teams.id, id)).returning();
    res.json(team);
  }),
);

// --- seasons --------------------------------------------------------------

api.get(
  '/seasons',
  handle(async (req, res) => {
    const teamId = req.query.teamId ? idParam.parse(req.query.teamId) : null;
    const rows = teamId
      ? await db.select().from(seasons).where(eq(seasons.teamId, teamId))
      : await db.select().from(seasons);
    res.json(rows.sort((a, b) => b.year - a.year || b.id - a.id));
  }),
);

api.post(
  '/seasons',
  handle(async (req, res) => {
    const body = z
      .object({
        teamId: idParam,
        term: z.enum(['fall', 'spring', 'summer', 'winter']),
        year: z.number().int(),
        startDate: z.string().nullish(),
        endDate: z.string().nullish(),
        firstPaymentCents: money.nullish(),
        firstPaymentDue: z.string().nullish(),
        finalPaymentDue: z.string().nullish(),
      })
      .parse(req.body);
    const [season] = await db.insert(seasons).values(body).returning();
    res.json(season);
  }),
);

api.patch(
  '/seasons/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z
      .object({
        startDate: z.string().nullish(),
        endDate: z.string().nullish(),
        firstPaymentCents: money.nullish(),
        firstPaymentDue: z.string().nullish(),
        finalPaymentDue: z.string().nullish(),
        status: z.enum(['active', 'closed']).optional(),
      })
      .parse(req.body);
    const [season] = await db.update(seasons).set(body).where(eq(seasons.id, id)).returning();
    res.json(season);
  }),
);

api.get(
  '/seasons/:id/budget',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    res.json(await computeSeasonBudget(id));
  }),
);

api.post(
  '/seasons/:id/rollover',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z
      .object({
        term: z.enum(['fall', 'spring', 'summer', 'winter']),
        year: z.number().int(),
        startDate: z.string().nullish(),
        endDate: z.string().nullish(),
        carryPlayerBalances: z.boolean().default(true),
        carryTeamFunds: z.boolean().default(true),
        copyCostRules: z.boolean().default(true),
        playerIds: z.array(idParam).optional(),
      })
      .parse(req.body);
    res.json(await rolloverSeason({ seasonId: id, ...body }));
  }),
);

// --- roster ---------------------------------------------------------------

api.get(
  '/seasons/:id/roster',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const rows = await db
      .select({
        seasonPlayerId: seasonPlayers.id,
        playerId: players.id,
        name: players.name,
        parentName: players.parentName,
        parentEmail: players.parentEmail,
        parentPhone: players.parentPhone,
        venmoHandle: players.venmoHandle,
        jerseyNumber: seasonPlayers.jerseyNumber,
        size: seasonPlayers.size,
        duesOverrideCents: seasonPlayers.duesOverrideCents,
        carriedBalanceCents: seasonPlayers.carriedBalanceCents,
      })
      .from(seasonPlayers)
      .innerJoin(players, eq(seasonPlayers.playerId, players.id))
      .where(eq(seasonPlayers.seasonId, id))
      .orderBy(players.name);
    res.json(rows);
  }),
);

// Creates the player on the team and adds them to this season in one step —
// the roster screen never wants one without the other.
api.post(
  '/seasons/:id/roster',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    const body = z
      .object({
        playerId: idParam.optional(),
        name: z.string().min(1).optional(),
        parentName: z.string().nullish(),
        parentEmail: z.string().email().nullish().or(z.literal('')),
        parentPhone: z.string().nullish(),
        venmoHandle: z.string().nullish(),
        jerseyNumber: z.string().nullish(),
        size: z.string().nullish(),
        duesOverrideCents: money.nullish(),
      })
      .parse(req.body);

    const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
    if (!season) throw new Error('season not found');

    let playerId = body.playerId;
    if (!playerId) {
      if (!body.name) throw new Error('name is required for a new player');
      const [player] = await db
        .insert(players)
        .values({
          teamId: season.teamId,
          name: body.name,
          parentName: body.parentName ?? null,
          parentEmail: body.parentEmail || null,
          parentPhone: body.parentPhone ?? null,
          venmoHandle: body.venmoHandle ?? null,
        })
        .returning();
      playerId = player.id;
    }

    const [row] = await db
      .insert(seasonPlayers)
      .values({
        seasonId,
        playerId,
        jerseyNumber: body.jerseyNumber ?? null,
        size: body.size ?? null,
        duesOverrideCents: body.duesOverrideCents ?? null,
      })
      .returning();
    res.json(row);
  }),
);

api.patch(
  '/players/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        parentName: z.string().nullish(),
        parentEmail: z.string().email().nullish().or(z.literal('')),
        parentPhone: z.string().nullish(),
        venmoHandle: z.string().nullish(),
        active: z.boolean().optional(),
      })
      .parse(req.body);
    // Drizzle skips undefined keys in .set(), which is what makes a partial
    // PATCH leave untouched columns alone. Coercing parentEmail unconditionally
    // would turn "not sent" into an explicit null and wipe a stored address, so
    // only normalise it when the caller actually sent the field.
    const patch: Record<string, unknown> = { ...body };
    if ('parentEmail' in body) patch.parentEmail = body.parentEmail || null;

    const [player] = await db
      .update(players)
      .set(patch)
      .where(eq(players.id, id))
      .returning();
    res.json(player);
  }),
);

api.patch(
  '/season-players/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z
      .object({
        jerseyNumber: z.string().nullish(),
        size: z.string().nullish(),
        duesOverrideCents: money.nullish(),
        carriedBalanceCents: money.optional(),
      })
      .parse(req.body);
    const [row] = await db
      .update(seasonPlayers)
      .set(body)
      .where(eq(seasonPlayers.id, id))
      .returning();
    res.json(row);
  }),
);

api.delete(
  '/season-players/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    await db.delete(seasonPlayers).where(eq(seasonPlayers.id, id));
    res.json({ ok: true });
  }),
);

// --- expenses & credits ---------------------------------------------------

api.post(
  '/seasons/:id/expenses',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    const body = z
      .object({
        category: z.enum(['training', 'ref_fees', 'tournaments', 'jerseys', 'misc']),
        label: z.string().min(1),
        amountCents: money,
        incurredOn: z.string().nullish(),
        note: z.string().nullish(),
      })
      .parse(req.body);
    const [row] = await db
      .insert(expenses)
      .values({ ...body, seasonId, source: 'manual' })
      .returning();
    res.json(row);
  }),
);

api.patch(
  '/expenses/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const [existing] = await db.select().from(expenses).where(eq(expenses.id, id));
    if (!existing) throw new Error('expense not found');
    // Derived rows are rewritten wholesale on every recalculation, so an edit
    // here would silently vanish. Send the treasurer to the rule instead.
    if (existing.source === 'derived') {
      throw new Error('this line is calculated from a cost rule — edit the rule or the event');
    }
    const body = z
      .object({
        category: z.enum(['training', 'ref_fees', 'tournaments', 'jerseys', 'misc']).optional(),
        label: z.string().min(1).optional(),
        amountCents: money.optional(),
        incurredOn: z.string().nullish(),
        note: z.string().nullish(),
      })
      .parse(req.body);
    const [row] = await db.update(expenses).set(body).where(eq(expenses.id, id)).returning();
    res.json(row);
  }),
);

api.delete(
  '/expenses/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const [existing] = await db.select().from(expenses).where(eq(expenses.id, id));
    if (existing?.source === 'derived') {
      throw new Error('this line is calculated from a cost rule — deactivate the rule instead');
    }
    await db.delete(expenses).where(eq(expenses.id, id));
    res.json({ ok: true });
  }),
);

api.post(
  '/seasons/:id/credits',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    const body = z
      .object({
        kind: z.enum(['credit', 'fundraiser', 'sponsor']),
        label: z.string().min(1),
        amountCents: money,
        receivedOn: z.string().nullish(),
        note: z.string().nullish(),
      })
      .parse(req.body);
    const [row] = await db
      .insert(credits)
      .values({ ...body, seasonId })
      .returning();
    res.json(row);
  }),
);

api.patch(
  '/credits/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z
      .object({
        kind: z.enum(['credit', 'fundraiser', 'sponsor']).optional(),
        label: z.string().min(1).optional(),
        amountCents: money.optional(),
        receivedOn: z.string().nullish(),
        note: z.string().nullish(),
      })
      .parse(req.body);
    const [row] = await db.update(credits).set(body).where(eq(credits.id, id)).returning();
    res.json(row);
  }),
);

api.delete(
  '/credits/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    await db.delete(credits).where(eq(credits.id, id));
    res.json({ ok: true });
  }),
);

// --- per-player fundraising -----------------------------------------------

// Money one player raised. Unlike a row in `credits`, this reduces that
// player's bill alone rather than being shared across the roster.
api.post(
  '/seasons/:id/player-credits',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    const body = z
      .object({
        playerId: idParam,
        kind: z.enum(['credit', 'fundraiser', 'sponsor']).default('fundraiser'),
        label: z.string().min(1),
        amountCents: money,
        receivedOn: z.string().nullish(),
        note: z.string().nullish(),
      })
      .parse(req.body);
    const [row] = await db
      .insert(playerCredits)
      .values({ ...body, seasonId })
      .returning();
    res.json(row);
  }),
);

api.patch(
  '/player-credits/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z
      .object({
        label: z.string().min(1).optional(),
        amountCents: money.optional(),
        receivedOn: z.string().nullish(),
        note: z.string().nullish(),
      })
      .parse(req.body);
    const [row] = await db
      .update(playerCredits)
      .set(body)
      .where(eq(playerCredits.id, id))
      .returning();
    res.json(row);
  }),
);

api.delete(
  '/player-credits/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    await db.delete(playerCredits).where(eq(playerCredits.id, id));
    res.json({ ok: true });
  }),
);

// --- payments (the ledger) -------------------------------------------------

api.get(
  '/seasons/:id/payments',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    const rows = await db
      .select({
        id: payments.id,
        playerId: payments.playerId,
        playerName: players.name,
        paidAt: payments.paidAt,
        amountCents: payments.amountCents,
        method: payments.method,
        note: payments.note,
        receiptPath: payments.receiptPath,
      })
      .from(payments)
      .innerJoin(players, eq(payments.playerId, players.id))
      .where(eq(payments.seasonId, seasonId))
      .orderBy(desc(payments.paidAt));
    res.json(rows);
  }),
);

api.post(
  '/seasons/:id/payments',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    const body = z
      .object({
        playerId: idParam,
        paidAt: z.string(),
        amountCents: money,
        method: z.enum(['venmo', 'cash', 'zelle', 'check', 'other']).default('venmo'),
        note: z.string().nullish(),
      })
      .parse(req.body);
    const [row] = await db
      .insert(payments)
      .values({ ...body, seasonId })
      .returning();
    res.json(row);
  }),
);

api.patch(
  '/payments/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z
      .object({
        paidAt: z.string().optional(),
        amountCents: money.optional(),
        method: z.enum(['venmo', 'cash', 'zelle', 'check', 'other']).optional(),
        note: z.string().nullish(),
      })
      .parse(req.body);
    const [row] = await db.update(payments).set(body).where(eq(payments.id, id)).returning();
    res.json(row);
  }),
);

api.delete(
  '/payments/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    await db.delete(payments).where(eq(payments.id, id));
    res.json({ ok: true });
  }),
);

// --- trainers & cost rules -------------------------------------------------

api.get(
  '/teams/:id/trainers',
  handle(async (req, res) => {
    const teamId = idParam.parse(req.params.id);
    res.json(await db.select().from(trainers).where(eq(trainers.teamId, teamId)));
  }),
);

api.post(
  '/teams/:id/trainers',
  handle(async (req, res) => {
    const teamId = idParam.parse(req.params.id);
    const body = z
      .object({
        name: z.string().min(1),
        initials: z.string().nullish(),
        defaultRateCents: money.default(0),
        rateUnit: z.enum(['per_session', 'flat']).default('per_session'),
        isPrimary: z.boolean().default(false),
        expectedSessions: z.number().int().min(0).default(0),
      })
      .parse(req.body);
    if (body.isPrimary) await clearPrimaryTrainer(teamId);
    const [row] = await db
      .insert(trainers)
      .values({ ...body, teamId })
      .returning();
    res.json(row);
  }),
);

// At most one primary per team, so promoting one demotes the rest.
async function clearPrimaryTrainer(teamId: number) {
  await db.update(trainers).set({ isPrimary: false }).where(eq(trainers.teamId, teamId));
}

api.patch(
  '/trainers/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        initials: z.string().nullish(),
        defaultRateCents: money.optional(),
        rateUnit: z.enum(['per_session', 'flat']).optional(),
        isPrimary: z.boolean().optional(),
        expectedSessions: z.number().int().min(0).optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body);
    const [existing] = await db.select().from(trainers).where(eq(trainers.id, id));
    if (!existing) throw new Error('trainer not found');
    if (body.isPrimary) await clearPrimaryTrainer(existing.teamId);
    const [row] = await db.update(trainers).set(body).where(eq(trainers.id, id)).returning();
    // A rate change moves money, so the derived lines have to follow it.
    const seasonRows = await db.select().from(seasons).where(eq(seasons.teamId, existing.teamId));
    for (const s of seasonRows) await recalculateDerivedExpenses(s.id);
    res.json(row);
  }),
);

// Attach the primary trainer to every event in a season that has none. Offered
// as an explicit action rather than done silently, because it changes the
// budget for events that already existed.
api.post(
  '/seasons/:id/apply-primary-trainer',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
    if (!season) throw new Error('season not found');
    const primary = await primaryTrainerFor(season.teamId);
    if (!primary) throw new Error('no primary trainer is set for this team');
    const updated = await db
      .update(events)
      .set({ trainerId: primary.id })
      .where(and(eq(events.seasonId, seasonId), isNull(events.trainerId)))
      .returning({ id: events.id });
    await recalculateDerivedExpenses(seasonId);
    res.json({ ok: true, updated: updated.length, trainer: primary.name });
  }),
);

api.get(
  '/seasons/:id/cost-rules',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    res.json(await db.select().from(costRules).where(eq(costRules.seasonId, seasonId)));
  }),
);

api.post(
  '/seasons/:id/cost-rules',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    const body = z
      .object({
        kind: z.enum(['ref_fee', 'training']),
        label: z.string().min(1),
        eventType: z.enum(['game', 'practice', 'tournament', 'other']),
        trainerId: idParam.nullish(),
        amountCents: money,
        unit: z.enum(['per_session', 'flat']).default('per_session'),
        expectedCount: z.number().int().min(0).default(0),
      })
      .parse(req.body);
    const [row] = await db
      .insert(costRules)
      .values({ ...body, seasonId })
      .returning();
    await recalculateDerivedExpenses(seasonId);
    res.json(row);
  }),
);

api.patch(
  '/cost-rules/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z
      .object({
        label: z.string().min(1).optional(),
        eventType: z.enum(['game', 'practice', 'tournament', 'other']).optional(),
        trainerId: idParam.nullish(),
        amountCents: money.optional(),
        unit: z.enum(['per_session', 'flat']).optional(),
        expectedCount: z.number().int().min(0).optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body);
    const [row] = await db.update(costRules).set(body).where(eq(costRules.id, id)).returning();
    await recalculateDerivedExpenses(row.seasonId);
    res.json(row);
  }),
);

api.delete(
  '/cost-rules/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const [row] = await db.select().from(costRules).where(eq(costRules.id, id));
    if (!row) throw new Error('cost rule not found');
    await db.delete(costRules).where(eq(costRules.id, id));
    await recalculateDerivedExpenses(row.seasonId);
    res.json({ ok: true });
  }),
);

// --- bank account ----------------------------------------------------------

api.get(
  '/teams/:id/bank',
  handle(async (req, res) => {
    const teamId = idParam.parse(req.params.id);
    res.json(await getLedger(teamId));
  }),
);

api.patch(
  '/teams/:id/bank',
  handle(async (req, res) => {
    const teamId = idParam.parse(req.params.id);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        startingBalanceCents: money.optional(),
        startingOn: z.string().nullish(),
      })
      .parse(req.body);
    const account = await getOrCreateAccount(teamId);
    const [row] = await db
      .update(bankAccounts)
      .set(body)
      .where(eq(bankAccounts.id, account.id))
      .returning();
    res.json(row);
  }),
);

// A hand-entered line: bank fee, cash deposit, a refund, anything that happened
// outside the app. Sign convention is the caller's — negative is money out.
api.post(
  '/teams/:id/bank/transactions',
  handle(async (req, res) => {
    const teamId = idParam.parse(req.params.id);
    const body = z
      .object({
        occurredOn: z.string(),
        description: z.string().min(1),
        amountCents: money,
        kind: z
          .enum(['deposit', 'withdrawal', 'fee', 'adjustment', 'expense_payment'])
          .default('adjustment'),
        seasonId: idParam.nullish(),
        note: z.string().nullish(),
      })
      .parse(req.body);
    const account = await getOrCreateAccount(teamId);
    const [row] = await db
      .insert(bankTransactions)
      .values({ ...body, accountId: account.id })
      .returning();
    res.json(row);
  }),
);

api.patch(
  '/bank/transactions/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z
      .object({
        occurredOn: z.string().optional(),
        description: z.string().min(1).optional(),
        amountCents: money.optional(),
        reconciled: z.boolean().optional(),
        note: z.string().nullish(),
      })
      .parse(req.body);
    const [row] = await db
      .update(bankTransactions)
      .set(body)
      .where(eq(bankTransactions.id, id))
      .returning();
    res.json(row);
  }),
);

api.delete(
  '/bank/transactions/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const [row] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, id));
    if (!row) throw new Error('bank transaction not found');
    // A transfer line owns the transferred flags on the payments it covered, so
    // deleting it has to put those back rather than orphaning them.
    if (row.kind === 'player_transfer') {
      await undoTransfer(id);
    } else {
      await db.delete(bankTransactions).where(eq(bankTransactions.id, id));
    }
    res.json({ ok: true });
  }),
);

// --- transfers from the treasurer's personal account ------------------------

api.get(
  '/teams/:id/untransferred',
  handle(async (req, res) => {
    const teamId = idParam.parse(req.params.id);
    res.json(await untransferredPayments(teamId));
  }),
);

api.post(
  '/teams/:id/transfer',
  handle(async (req, res) => {
    const teamId = idParam.parse(req.params.id);
    const body = z
      .object({
        paymentIds: z.array(idParam).min(1),
        transferredOn: z.string(),
      })
      .parse(req.body);
    res.json(await transferPayments(teamId, body.paymentIds, body.transferredOn));
  }),
);

// --- trainer payables -------------------------------------------------------

api.get(
  '/seasons/:id/trainer-ledger',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    res.json(await trainerLedger(seasonId));
  }),
);

api.post(
  '/seasons/:id/trainer-payments',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    const body = z
      .object({
        trainerId: idParam,
        paidOn: z.string(),
        amountCents: money,
        method: z.enum(['venmo', 'cash', 'zelle', 'check', 'other']).default('venmo'),
        note: z.string().nullish(),
      })
      .parse(req.body);
    res.json(await payTrainer({ seasonId, ...body }));
  }),
);

api.delete(
  '/trainer-payments/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    await deleteTrainerPayment(id);
    res.json({ ok: true });
  }),
);

api.get(
  '/teams/:id/bank/export.csv',
  handle(async (req, res) => {
    const teamId = idParam.parse(req.params.id);
    const ledger = await getLedger(teamId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="bank-ledger.csv"');
    res.send(bankLedgerCsv(ledger));
  }),
);

// --- paying things out of the account ---------------------------------------

api.post(
  '/expenses/:id/pay',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z.object({ paidOn: z.string() }).parse(req.body);
    res.json(await markExpensePaid(id, body.paidOn));
  }),
);

api.post(
  '/expenses/:id/unpay',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    res.json(await markExpenseUnpaid(id));
  }),
);

api.post(
  '/tournaments/:id/pay',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z.object({ paidOn: z.string() }).parse(req.body);
    res.json(await markTournamentPaid(id, body.paidOn));
  }),
);

api.post(
  '/tournaments/:id/unpay',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    res.json(await markTournamentUnpaid(id));
  }),
);

// --- roster instalment tick boxes -------------------------------------------

api.post(
  '/seasons/:id/installment',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    const body = z
      .object({
        playerId: idParam,
        which: z.enum(['first', 'final']),
        paid: z.boolean(),
        paidAt: z.string().optional(),
      })
      .parse(req.body);
    res.json(await setInstallmentPaid({ seasonId, ...body }));
  }),
);

// --- tournaments -----------------------------------------------------------

api.get(
  '/seasons/:id/tournaments',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    res.json(
      await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.seasonId, seasonId))
        .orderBy(tournaments.startDate),
    );
  }),
);

api.post(
  '/seasons/:id/tournaments',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    const body = z
      .object({
        name: z.string().min(1),
        startDate: z.string().nullish(),
        endDate: z.string().nullish(),
        registrationCents: money.default(0),
        estimated: z.boolean().default(false),
        note: z.string().nullish(),
      })
      .parse(req.body);
    const [row] = await db
      .insert(tournaments)
      .values({ ...body, seasonId })
      .returning();
    await recalculateDerivedExpenses(seasonId);
    res.json(row);
  }),
);

api.patch(
  '/tournaments/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        startDate: z.string().nullish(),
        endDate: z.string().nullish(),
        registrationCents: money.optional(),
        estimated: z.boolean().optional(),
        note: z.string().nullish(),
      })
      .parse(req.body);
    const [row] = await db
      .update(tournaments)
      .set(body)
      .where(eq(tournaments.id, id))
      .returning();
    await recalculateDerivedExpenses(row.seasonId);
    res.json(row);
  }),
);

api.delete(
  '/tournaments/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const [row] = await db.select().from(tournaments).where(eq(tournaments.id, id));
    if (!row) throw new Error('tournament not found');
    await db.delete(tournaments).where(eq(tournaments.id, id));
    await recalculateDerivedExpenses(row.seasonId);
    res.json({ ok: true });
  }),
);

// --- schedule --------------------------------------------------------------

api.get(
  '/seasons/:id/events',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    res.json(await listEventsWithCosts(seasonId));
  }),
);

api.post(
  '/seasons/:id/events',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    const body = z
      .object({
        title: z.string().min(1),
        location: z.string().nullish(),
        startsAt: z.string(),
        endsAt: z.string().nullish(),
        type: z.enum(['game', 'practice', 'tournament', 'other']),
        trainerId: idParam.nullish(),
      })
      .parse(req.body);
    const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
    if (!season) throw new Error('season not found');
    // No trainer named means "whoever normally runs these".
    const trainerId =
      body.trainerId ?? (await primaryTrainerFor(season.teamId))?.id ?? null;

    const [row] = await db
      .insert(events)
      .values({
        seasonId,
        source: 'manual',
        title: body.title,
        location: body.location ?? null,
        startsAt: new Date(body.startsAt),
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
        type: body.type,
        // Typed in by a human, so it is authoritative from the start.
        typeConfirmed: true,
        trainerId,
      })
      .returning();
    await recalculateDerivedExpenses(seasonId);
    res.json(row);
  }),
);

api.patch(
  '/events/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z
      .object({
        title: z.string().min(1).optional(),
        location: z.string().nullish(),
        type: z.enum(['game', 'practice', 'tournament', 'other']).optional(),
        trainerId: idParam.nullish(),
        cancelled: z.boolean().optional(),
      })
      .parse(req.body);
    const [row] = await db
      .update(events)
      .set({
        ...body,
        // Any hand edit of the type pins it against future syncs.
        ...(body.type ? { typeConfirmed: true } : {}),
      })
      .where(eq(events.id, id))
      .returning();
    await recalculateDerivedExpenses(row.seasonId);
    res.json(row);
  }),
);

api.delete(
  '/events/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const [row] = await db.select().from(events).where(eq(events.id, id));
    if (!row) throw new Error('event not found');
    await db.delete(events).where(eq(events.id, id));
    await recalculateDerivedExpenses(row.seasonId);
    res.json({ ok: true });
  }),
);

// Override one event's charge without changing the rule — the rained-out game
// that still cost a ref show-up fee, or the session the trainer comped.
api.patch(
  '/event-charges/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z
      .object({ amountCents: money, note: z.string().nullish() })
      .parse(req.body);
    const [row] = await db
      .update(eventCharges)
      .set({ ...body, overridden: true })
      .where(eq(eventCharges.id, id))
      .returning();
    const [event] = await db.select().from(events).where(eq(events.id, row.eventId));
    if (event) await recalculateDerivedExpenses(event.seasonId);
    res.json(row);
  }),
);

api.post(
  '/event-charges/:id/reset',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const [row] = await db
      .update(eventCharges)
      .set({ overridden: false, note: null })
      .where(eq(eventCharges.id, id))
      .returning();
    const [event] = await db.select().from(events).where(eq(events.id, row.eventId));
    if (event) await recalculateDerivedExpenses(event.seasonId);
    res.json(row);
  }),
);

// --- calendar feeds --------------------------------------------------------

api.get(
  '/seasons/:id/feeds',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    res.json(await db.select().from(icalFeeds).where(eq(icalFeeds.seasonId, seasonId)));
  }),
);

api.post(
  '/seasons/:id/feeds',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    const body = z
      .object({ url: z.string().min(1), label: z.string().nullish() })
      .parse(req.body);
    const [row] = await db
      .insert(icalFeeds)
      .values({ ...body, seasonId })
      .returning();
    res.json(row);
  }),
);

api.delete(
  '/feeds/:id',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    await db.delete(icalFeeds).where(eq(icalFeeds.id, id));
    res.json({ ok: true });
  }),
);

api.post(
  '/feeds/:id/sync',
  handle(async (req, res) => {
    const id = idParam.parse(req.params.id);
    res.json(await syncFeed(id));
  }),
);

// --- exports ---------------------------------------------------------------

async function seasonMeta(seasonId: number) {
  const [row] = await db
    .select({ teamName: teams.name, term: seasons.term, year: seasons.year })
    .from(seasons)
    .innerJoin(teams, eq(seasons.teamId, teams.id))
    .where(eq(seasons.id, seasonId));
  if (!row) throw new Error('season not found');
  const term = row.term.charAt(0).toUpperCase() + row.term.slice(1);
  return { teamName: row.teamName, seasonLabel: `${term} ${row.year}`, slug: `${row.term}-${row.year}` };
}

const CSV_EXPORTS = {
  roster: rosterCsv,
  ledger: ledgerCsv,
  budget: budgetCsv,
  balances: balancesCsv,
} as const;

api.get(
  '/seasons/:id/export/:kind.csv',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    const kind = z.enum(['roster', 'ledger', 'budget', 'balances']).parse(req.params.kind);
    const [budget, meta] = await Promise.all([
      computeSeasonBudget(seasonId),
      seasonMeta(seasonId),
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${kind}-${meta.slug}.csv"`);
    res.send(CSV_EXPORTS[kind](budget));
  }),
);

api.get(
  '/seasons/:id/export/budget.pdf',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    const [budget, meta] = await Promise.all([
      computeSeasonBudget(seasonId),
      seasonMeta(seasonId),
    ]);
    const pdf = await budgetPdf(budget, meta);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="budget-${meta.slug}.pdf"`);
    res.send(pdf);
  }),
);

api.get(
  '/seasons/:id/export/budget-sheet.pdf',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    const [budget, meta] = await Promise.all([
      computeSeasonBudget(seasonId),
      seasonMeta(seasonId),
    ]);
    const pdf = await budgetSheetPdf(budget, meta);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="budget-sheet-${meta.slug}.pdf"`);
    res.send(pdf);
  }),
);

api.get(
  '/seasons/:id/export/statement/:playerId.pdf',
  handle(async (req, res) => {
    const seasonId = idParam.parse(req.params.id);
    const playerId = idParam.parse(req.params.playerId);
    const [budget, meta] = await Promise.all([
      computeSeasonBudget(seasonId),
      seasonMeta(seasonId),
    ]);
    const player = budget.playerBalances.find((p) => p.playerId === playerId);
    if (!player) throw new Error('player is not on this season roster');
    const pdf = await playerStatementPdf(player, budget, meta);
    const safeName = player.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="statement-${safeName}-${meta.slug}.pdf"`);
    res.send(pdf);
  }),
);
