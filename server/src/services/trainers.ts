import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { trainers } from '../db/schema.js';

// The trainer who runs everything unless told otherwise. Both the calendar
// import and hand-added events fall back to them, so a team with one coach
// never has to touch the trainer field.
//
// Lives here rather than in a route so sync.ts can use it without importing the
// Express layer.
export async function primaryTrainerFor(teamId: number) {
  const [row] = await db
    .select()
    .from(trainers)
    .where(and(eq(trainers.teamId, teamId), eq(trainers.isPrimary, true), eq(trainers.active, true)))
    .limit(1);
  return row ?? null;
}

// How many sessions this trainer is forecast for.
//
// The four seasonal counts are the real answer. The old single total is only
// consulted when all four are zero, so a trainer set up before the breakdown
// existed keeps their forecast — and therefore the budget keeps its number —
// until someone fills the new fields in. Once they do, the breakdown wins and
// the legacy figure stops mattering.
export function expectedSessionsFor(trainer: {
  expectedFallGames: number;
  expectedFallPractices: number;
  expectedSpringGames: number;
  expectedSpringPractices: number;
  expectedSessions: number;
}): number {
  const broken =
    trainer.expectedFallGames +
    trainer.expectedFallPractices +
    trainer.expectedSpringGames +
    trainer.expectedSpringPractices;
  return broken > 0 ? broken : trainer.expectedSessions;
}
