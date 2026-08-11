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
  // Future events the feed stopped publishing, cancelled so they stop costing.
  removed: number;
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

// One concrete occurrence of a calendar entry, already normalized. A repeating
// practice becomes N of these.
export type FeedOccurrence = {
  // Stable across syncs. A repeating series gets one row per occurrence, keyed
  // by its start, so editing week 7 does not disturb weeks 1-6.
  externalUid: string;
  title: string;
  location: string | null;
  startsAt: Date;
  endsAt: Date | null;
  cancelled: boolean;
  description: string | null;
};

// A rule with no UNTIL and no COUNT repeats forever. The window bounds it, but a
// daily rule over a two-year window is still 730 rows, so cap it as well.
const MAX_OCCURRENCES_PER_SERIES = 400;

// The span to expand recurring rules over. Uses the season's own dates when set;
// otherwise a generous window around the season year, because a fall season runs
// into the following calendar year.
export function expansionWindow(season: {
  year: number;
  startDate: string | null;
  endDate: string | null;
}): { from: Date; to: Date } {
  if (season.startDate && season.endDate) {
    return {
      from: new Date(`${season.startDate}T00:00:00Z`),
      to: new Date(`${season.endDate}T23:59:59Z`),
    };
  }
  return {
    from: new Date(Date.UTC(season.year, 0, 1)),
    to: new Date(Date.UTC(season.year + 1, 11, 31, 23, 59, 59)),
  };
}

// Turns a parsed feed into concrete occurrences.
//
// This is the difference between a weekly practice costing one session and
// costing twelve. A repeating practice can be published either as separate
// VEVENTs or as one VEVENT carrying an RRULE, and the second shape used to
// import as a single event — under-billing training by the length of the season.
//
// node-ical's expander applies EXDATE (individual weeks cancelled) and
// RECURRENCE-ID overrides (one week moved) for us.
export function expandFeedOccurrences(
  parsed: CalendarResponse,
  window: { from: Date; to: Date },
): { occurrences: FeedOccurrence[]; skipped: number } {
  const occurrences: FeedOccurrence[] = [];
  let skipped = 0;

  for (const component of Object.values(parsed)) {
    if (!component || component.type !== 'VEVENT') continue;
    const vevent = component as VEvent;
    const uid = text(vevent.uid);
    if (!uid || !vevent.start) {
      skipped += 1;
      continue;
    }

    // A RECURRENCE-ID entry is an override of one occurrence of another series.
    // The expander folds it into its parent, so importing it separately would
    // double-count that week.
    if ((vevent as { recurrenceid?: unknown }).recurrenceid) continue;

    const base = {
      title: (text(vevent.summary) ?? 'Untitled').trim(),
      location: text(vevent.location),
      description: text(vevent.description),
      cancelled: isCancelled(vevent),
    };

    if (!vevent.rrule) {
      occurrences.push({
        externalUid: uid,
        startsAt: new Date(vevent.start),
        endsAt: vevent.end ? new Date(vevent.end) : null,
        ...base,
      });
      continue;
    }

    let instances: ReturnType<typeof ical.expandRecurringEvent>;
    try {
      instances = ical.expandRecurringEvent(vevent, { from: window.from, to: window.to });
    } catch (err) {
      // A malformed rule must not lose the whole series: fall back to the single
      // base occurrence rather than dropping it.
      console.error(`[sync] could not expand ${uid}: ${err instanceof Error ? err.message : err}`);
      occurrences.push({
        externalUid: uid,
        startsAt: new Date(vevent.start),
        endsAt: vevent.end ? new Date(vevent.end) : null,
        ...base,
      });
      continue;
    }

    if (instances.length > MAX_OCCURRENCES_PER_SERIES) {
      console.error(
        `[sync] ${uid} expands to ${instances.length} occurrences; capping at ${MAX_OCCURRENCES_PER_SERIES}`,
      );
      instances = instances.slice(0, MAX_OCCURRENCES_PER_SERIES);
    }

    for (const inst of instances) {
      const start = new Date(inst.start);
      occurrences.push({
        // Suffixed with the occurrence start so each week is its own row and
        // keeps its own confirmed type, trainer and charge overrides.
        externalUid: `${uid}#${start.toISOString()}`,
        title: (text(inst.summary) ?? base.title).trim(),
        location: text(inst.event?.location) ?? base.location,
        description: text(inst.event?.description) ?? base.description,
        startsAt: start,
        endsAt: inst.end ? new Date(inst.end) : null,
        cancelled: inst.isOverride ? isCancelled(inst.event) : base.cancelled,
      });
    }
  }

  return { occurrences, skipped };
}

export async function syncFeed(feedId: number): Promise<SyncResult> {
  const [feed] = await db.select().from(icalFeeds).where(eq(icalFeeds.id, feedId));
  if (!feed) throw new Error(`feed ${feedId} not found`);

  const result: SyncResult = { feedId, imported: 0, updated: 0, cancelled: 0, removed: 0, skipped: 0 };

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

  if (!season) throw new Error(`season ${feed.seasonId} not found`);

  const { occurrences, skipped } = expandFeedOccurrences(parsed, expansionWindow(season));
  result.skipped = skipped;

  const seen = new Set<string>();

  for (const occ of occurrences) {
    seen.add(occ.externalUid);
    const guessedType = classifyEvent(occ.title, occ.description ?? undefined);

    const [existing] = await db
      .select()
      .from(events)
      .where(and(eq(events.seasonId, feed.seasonId), eq(events.externalUid, occ.externalUid)));

    if (existing) {
      await db
        .update(events)
        .set({
          title: occ.title,
          location: occ.location,
          startsAt: occ.startsAt,
          endsAt: occ.endsAt,
          cancelled: occ.cancelled,
          // A type the treasurer confirmed is theirs, not ours. Re-guessing it
          // on every sync would silently undo their corrections and quietly
          // change the budget.
          ...(existing.typeConfirmed ? {} : { type: guessedType }),
        })
        .where(eq(events.id, existing.id));
      result.updated += 1;
      if (occ.cancelled && !existing.cancelled) result.cancelled += 1;
    } else {
      await db.insert(events).values({
        seasonId: feed.seasonId,
        feedId: feed.id,
        source: 'ical',
        externalUid: occ.externalUid,
        title: occ.title,
        location: occ.location,
        startsAt: occ.startsAt,
        endsAt: occ.endsAt,
        type: guessedType,
        cancelled: occ.cancelled,
        trainerId: defaultTrainerId,
      });
      result.imported += 1;
    }
  }

  // Entries this feed used to publish and no longer does — a game removed from
  // TeamSnap, or a repeating rule shortened from twelve weeks to ten.
  //
  // Only *future* ones are cancelled. A feed that publishes a rolling window
  // drops past events as they age out, and cancelling those would silently erase
  // costs the team genuinely incurred. They are marked rather than deleted so a
  // hand-set type or charge override is never destroyed.
  const fromThisFeed = await db
    .select()
    .from(events)
    .where(and(eq(events.feedId, feed.id), eq(events.cancelled, false)));

  const now = new Date();
  for (const event of fromThisFeed) {
    if (!event.externalUid || seen.has(event.externalUid)) continue;
    if (event.startsAt <= now) continue;
    await db.update(events).set({ cancelled: true }).where(eq(events.id, event.id));
    result.cancelled += 1;
    result.removed += 1;
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
        removed: 0,
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
