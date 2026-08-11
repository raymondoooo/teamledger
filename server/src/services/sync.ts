import { and, eq } from 'drizzle-orm';
import ical, { type CalendarResponse, type VEvent } from 'node-ical';
import { db } from '../db/index.js';
import { events, icalFeeds, seasons } from '../db/schema.js';
import { recalculateDerivedExpenses } from './budget.js';
import { primaryTrainerFor } from './trainers.js';

// TeamSnap stays the schedule system of record — the coach edits there, and we
// import. Their Schedule → Subscribe/Export screen hands out a per-team (or
// combined) iCal URL that needs no OAuth, just a periodic GET.
//
// TeamSnap can take up to 24h to publish a schedule edit into that feed, so
// polling more often than a few hours buys nothing.

export type SyncResult = {
  feedId: number;
  imported: number;
  updated: number;
  cancelled: number;
  skipped: number;
  error?: string;
};

// TeamSnap titles games as "vs Rivals" / "@ Rivals" and practices as
// "Practice" or "Training", but leagues and coaches are inconsistent, so this
// is a best guess that the treasurer can correct. Once they do, typeConfirmed
// pins it and no future sync touches it again.
export function classifyEvent(title: string, description?: string): 'game' | 'practice' | 'tournament' | 'other' {
  const haystack = `${title} ${description ?? ''}`.toLowerCase().trim();
  if (/\b(tournament|showcase|cup|classic|festival)\b/.test(haystack)) return 'tournament';
  if (/\b(practice|training|session|skills)\b/.test(haystack)) return 'practice';
  // "vs" and "@" are the away/home notation TeamSnap generates. `@` gets its
  // own alternative because \b never matches before a non-word character, and
  // "at" is anchored to the start so "Team photos at the field" is not a game.
  if (/(^|\s)(vs\.?|@)\s*\S/.test(haystack)) return 'game';
  if (/^at\s+\S/.test(haystack)) return 'game';
  if (/\b(game|match|friendly|scrimmage)\b/.test(haystack)) return 'game';
  return 'other';
}

// SUMMARY, LOCATION and friends come back either as a plain string or as
// {val, params} when the VEVENT carried parameters (ALTREP, LANGUAGE). Every
// read of those fields goes through here so neither shape reaches the database.
function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'val' in (value as Record<string, unknown>)) {
    const inner = (value as { val: unknown }).val;
    return typeof inner === 'string' ? inner : String(inner);
  }
  return String(value);
}

function isCancelled(component: VEvent): boolean {
  const status = (text(component.status) ?? '').toUpperCase();
  if (status === 'CANCELLED') return true;
  // TeamSnap sometimes leaves STATUS alone and edits the title instead.
  return /\bcancell?ed\b/i.test(text(component.summary) ?? '');
}

export async function syncFeed(feedId: number): Promise<SyncResult> {
  const [feed] = await db.select().from(icalFeeds).where(eq(icalFeeds.id, feedId));
  if (!feed) throw new Error(`feed ${feedId} not found`);

  const result: SyncResult = { feedId, imported: 0, updated: 0, cancelled: 0, skipped: 0 };

  // Newly imported events get the primary trainer, so a team with one coach
  // does not have to set them one by one. Existing events keep whoever they
  // already have — re-syncing must not silently re-bill a reassigned session.
  const [season] = await db.select().from(seasons).where(eq(seasons.id, feed.seasonId));
  const defaultTrainerId = season ? ((await primaryTrainerFor(season.teamId))?.id ?? null) : null;

  let parsed: CalendarResponse;
  try {
    // webcal:// is just https:// with a different scheme hint for calendar
    // clients; node-ical will not fetch it, so normalize before requesting.
    const url = feed.url.replace(/^webcal:\/\//i, 'https://');
    parsed = await ical.async.fromURL(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(icalFeeds)
      .set({ lastError: message, lastSyncedAt: new Date() })
      .where(eq(icalFeeds.id, feedId));
    return { ...result, error: message };
  }

  for (const component of Object.values(parsed)) {
    if (!component || component.type !== 'VEVENT') continue;
    const vevent = component as VEvent;
    const uid = text(vevent.uid);
    if (!uid || !vevent.start) {
      result.skipped += 1;
      continue;
    }

    const title = (text(vevent.summary) ?? 'Untitled').trim();
    const location = text(vevent.location);
    const cancelled = isCancelled(vevent);
    const guessedType = classifyEvent(title, text(vevent.description) ?? undefined);

    const [existing] = await db
      .select()
      .from(events)
      .where(and(eq(events.seasonId, feed.seasonId), eq(events.externalUid, uid)));

    if (existing) {
      await db
        .update(events)
        .set({
          title,
          location,
          startsAt: new Date(vevent.start),
          endsAt: vevent.end ? new Date(vevent.end) : null,
          cancelled,
          // A type the treasurer confirmed is theirs, not ours. Re-guessing it
          // on every sync would silently undo their corrections and quietly
          // change the budget.
          ...(existing.typeConfirmed ? {} : { type: guessedType }),
        })
        .where(eq(events.id, existing.id));
      result.updated += 1;
      if (cancelled && !existing.cancelled) result.cancelled += 1;
    } else {
      await db.insert(events).values({
        seasonId: feed.seasonId,
        feedId: feed.id,
        source: 'ical',
        externalUid: uid,
        title,
        location,
        startsAt: new Date(vevent.start),
        endsAt: vevent.end ? new Date(vevent.end) : null,
        type: guessedType,
        cancelled,
        trainerId: defaultTrainerId,
      });
      result.imported += 1;
    }
  }

  await db
    .update(icalFeeds)
    .set({ lastSyncedAt: new Date(), lastError: null })
    .where(eq(icalFeeds.id, feedId));

  // New or cancelled games change what the team owes in ref fees, so the
  // derived expense lines have to be rebuilt before anyone reads the budget.
  await recalculateDerivedExpenses(feed.seasonId);

  return result;
}

export async function syncAllFeeds(): Promise<SyncResult[]> {
  const feeds = await db.select().from(icalFeeds);
  const results: SyncResult[] = [];
  for (const feed of feeds) {
    try {
      results.push(await syncFeed(feed.id));
    } catch (err) {
      results.push({
        feedId: feed.id,
        imported: 0,
        updated: 0,
        cancelled: 0,
        skipped: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

// Started from index.ts. Deliberately a plain interval rather than a cron
// dependency: one timer in one process, and the container restarting simply
// restarts the clock.
export function startSyncScheduler(): NodeJS.Timeout | null {
  const minutes = Number(process.env.ICAL_SYNC_INTERVAL_MINUTES ?? 360);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    console.log('[sync] scheduler disabled');
    return null;
  }
  const run = () => {
    syncAllFeeds()
      .then((results) => {
        const active = results.filter((r) => r.imported || r.updated || r.error);
        for (const r of active) {
          if (r.error) console.error(`[sync] feed ${r.feedId} failed: ${r.error}`);
          else console.log(`[sync] feed ${r.feedId}: +${r.imported} ~${r.updated}`);
        }
      })
      .catch((err) => console.error('[sync] scheduler error:', err));
  };
  console.log(`[sync] scheduler every ${minutes}m`);
  return setInterval(run, minutes * 60 * 1000);
}
