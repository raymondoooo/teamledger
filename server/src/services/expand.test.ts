import ical from 'node-ical';
import { describe, expect, it } from 'vitest';
import { expandFeedOccurrences, expansionWindow } from './sync.js';

// The window every test expands over unless it needs a different one.
const WINDOW = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z') };

function feed(...vevents: string[]): ical.CalendarResponse {
  return ical.parseICS(
    ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...vevents, 'END:VCALENDAR'].join('\r\n'),
  );
}

const vevent = (lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');

describe('expandFeedOccurrences', () => {
  it('expands a weekly practice into one occurrence per week', () => {
    // The bug this exists to prevent: a season of practices published as a
    // single RRULE event used to import as ONE practice, billing $200 of
    // training instead of $2,400.
    const parsed = feed(
      vevent([
        'UID:practice-series@teamsnap',
        'DTSTART:20260305T220000Z',
        'DTEND:20260305T233000Z',
        'SUMMARY:Practice',
        'RRULE:FREQ=WEEKLY;COUNT=12',
      ]),
    );
    const { occurrences } = expandFeedOccurrences(parsed, WINDOW);
    expect(occurrences).toHaveLength(12);
    // Every occurrence is its own row, so week 7 can be retyped or cancelled
    // without disturbing the rest.
    expect(new Set(occurrences.map((o) => o.externalUid)).size).toBe(12);
    expect(occurrences[0].startsAt.toISOString()).toBe('2026-03-05T22:00:00.000Z');
    expect(occurrences[1].startsAt.toISOString()).toBe('2026-03-12T22:00:00.000Z');
    expect(occurrences.every((o) => o.title === 'Practice')).toBe(true);
  });

  it('leaves a one-off event with its own UID, unsuffixed', () => {
    const parsed = feed(
      vevent([
        'UID:single-game@teamsnap',
        'DTSTART:20260404T180000Z',
        'SUMMARY:vs Rivals SC',
      ]),
    );
    const { occurrences } = expandFeedOccurrences(parsed, WINDOW);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].externalUid).toBe('single-game@teamsnap');
  });

  it('honours EXDATE so a skipped week is not billed', () => {
    const parsed = feed(
      vevent([
        'UID:with-exdate@teamsnap',
        'DTSTART:20260305T220000Z',
        'SUMMARY:Practice',
        'RRULE:FREQ=WEEKLY;COUNT=4',
        'EXDATE:20260319T220000Z',
      ]),
    );
    const { occurrences } = expandFeedOccurrences(parsed, WINDOW);
    expect(occurrences).toHaveLength(3);
    expect(occurrences.map((o) => o.startsAt.toISOString())).not.toContain('2026-03-19T22:00:00.000Z');
  });

  it('does not double-count a week that was moved (RECURRENCE-ID override)', () => {
    // The override is a separate VEVENT sharing the series UID. Importing it as
    // its own event as well as expanding the series would bill that week twice.
    const parsed = feed(
      vevent([
        'UID:moved@teamsnap',
        'DTSTART:20260305T220000Z',
        'SUMMARY:Practice',
        'RRULE:FREQ=WEEKLY;COUNT=3',
      ]),
      vevent([
        'UID:moved@teamsnap',
        'RECURRENCE-ID:20260312T220000Z',
        'DTSTART:20260313T200000Z',
        'SUMMARY:Practice (moved)',
      ]),
    );
    const { occurrences } = expandFeedOccurrences(parsed, WINDOW);
    expect(occurrences).toHaveLength(3);
  });

  it('clips a series to the expansion window rather than running forever', () => {
    // No COUNT and no UNTIL: this rule repeats indefinitely.
    const parsed = feed(
      vevent([
        'UID:forever@teamsnap',
        'DTSTART:20260101T220000Z',
        'SUMMARY:Practice',
        'RRULE:FREQ=WEEKLY',
      ]),
    );
    const { occurrences } = expandFeedOccurrences(parsed, {
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-03-01T00:00:00Z'),
    });
    expect(occurrences.length).toBeGreaterThan(5);
    expect(occurrences.length).toBeLessThan(12);
    expect(occurrences.every((o) => o.startsAt <= new Date('2026-03-01T00:00:00Z'))).toBe(true);
  });

  it('skips entries with no UID or no start instead of importing junk', () => {
    const parsed = feed(vevent(['UID:no-start@teamsnap', 'SUMMARY:Broken']));
    const { occurrences, skipped } = expandFeedOccurrences(parsed, WINDOW);
    expect(occurrences).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('carries cancellation through to every occurrence', () => {
    const parsed = feed(
      vevent([
        'UID:cancelled-series@teamsnap',
        'DTSTART:20260305T220000Z',
        'SUMMARY:Practice',
        'STATUS:CANCELLED',
        'RRULE:FREQ=WEEKLY;COUNT=3',
      ]),
    );
    const { occurrences } = expandFeedOccurrences(parsed, WINDOW);
    expect(occurrences).toHaveLength(3);
    expect(occurrences.every((o) => o.cancelled)).toBe(true);
  });
});

describe('expansionWindow', () => {
  it('uses the season dates when they are set', () => {
    const w = expansionWindow({ year: 2026, startDate: '2026-03-01', endDate: '2026-06-30' });
    expect(w.from.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-06-30T23:59:59.000Z');
  });

  it('spans into the following year when dates are missing', () => {
    // A fall season runs past December, so a window of just the season year
    // would silently drop the back half of it.
    const w = expansionWindow({ year: 2026, startDate: null, endDate: null });
    expect(w.from.getUTCFullYear()).toBe(2026);
    expect(w.to.getUTCFullYear()).toBe(2027);
  });
});
