import { describe, expect, it } from 'vitest';
import { cacheBusted, classifyEvent } from './sync.js';

describe('classifyEvent', () => {
  it('reads TeamSnap’s game titles', () => {
    expect(classifyEvent('vs Rivals SC')).toBe('game');
    expect(classifyEvent('@ Thunder United')).toBe('game');
    expect(classifyEvent('Game vs Riverside')).toBe('game');
  });

  it('reads practice and training titles', () => {
    expect(classifyEvent('Practice')).toBe('practice');
    expect(classifyEvent('Team Training')).toBe('practice');
    expect(classifyEvent('Goalie skills session')).toBe('practice');
  });

  it('picks tournament over game when a title says both', () => {
    // "Spring Cup — vs Rivals" is a tournament fixture; billing it as a plain
    // league game would apply the wrong ref-fee rule.
    expect(classifyEvent('Spring Cup — vs Rivals')).toBe('tournament');
    expect(classifyEvent('Spring Showcase')).toBe('tournament');
  });

  it('falls back to other rather than guessing', () => {
    expect(classifyEvent('Team photos')).toBe('other');
    expect(classifyEvent('Parent meeting')).toBe('other');
    // A stray "at" in a non-game title must not bill the team a ref fee.
    expect(classifyEvent('Team photos at the field')).toBe('other');
  });

  it('treats a leading "at" as an away game', () => {
    expect(classifyEvent('at Rivals SC')).toBe('game');
  });

  it('reads the description when the title is uninformative', () => {
    expect(classifyEvent('Riverside', 'Weekly practice at the dome')).toBe('practice');
  });
});

// TeamSnap fronts its feeds with Cloudflare at max-age=14400. Without a unique
// parameter the edge serves the same body for four hours, so "Sync now" returns
// a schedule that predates whatever the treasurer just added — observed as 10
// events from the cache against 11 at the origin.
describe('cacheBusted', () => {
  it('adds a parameter, so the edge cache key differs every time', () => {
    const a = new URL(cacheBusted('https://ical-cdn.teamsnap.com/team_schedule/abc.ics'));
    expect(a.searchParams.get('_tl')).toBeTruthy();
  });

  it('keeps the parameters the feed URL already carries', () => {
    // TeamSnap's links are tokenised. Rebuilding the query rather than
    // appending to it would strip the token and turn every sync into a 403.
    const out = new URL(cacheBusted('https://example.com/f.ics?token=secret&team=7'));
    expect(out.searchParams.get('token')).toBe('secret');
    expect(out.searchParams.get('team')).toBe('7');
    expect(out.pathname).toBe('/f.ics');
  });

  it('does not accumulate parameters when called repeatedly', () => {
    // The stored feed URL is never overwritten with the busted one, but if that
    // ever changed, a parameter that appended rather than replaced would grow
    // the URL on every sync until the request failed.
    const once = cacheBusted('https://example.com/f.ics');
    const twice = cacheBusted(once);
    expect([...new URL(twice).searchParams.keys()].filter((k) => k === '_tl')).toHaveLength(1);
  });
});
