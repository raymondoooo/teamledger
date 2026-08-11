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
