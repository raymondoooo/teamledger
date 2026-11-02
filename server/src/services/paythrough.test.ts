import { describe, expect, it } from 'vitest';
import { paidThrough, quotePayDay, type DatedSession } from './paythrough.js';

let id = 0;
const s = (date: string, amountCents = 10000, title = 'Practice'): DatedSession => ({
  eventId: ++id,
  date,
  title,
  amountCents,
});

// A typical week: Tuesday and Thursday practice, Saturday game, two Sunday games.
const week = [
  s('2026-10-20'),
  s('2026-10-22'),
  s('2026-10-24', 10000, 'Game'),
  s('2026-10-25', 10000, 'Game 1'),
  s('2026-10-25', 10000, 'Game 2'),
];

describe('paidThrough', () => {
  it('is null with nothing paid', () => {
    expect(paidThrough(week, 0)).toEqual({ paidThrough: null, creditCents: 0 });
  });

  it('lands on the last fully paid day', () => {
    expect(paidThrough(week, 30000)).toEqual({ paidThrough: '2026-10-24', creditCents: 0 });
  });

  it('does not count a day as paid until every session on it is', () => {
    // One of Sunday's two games is paid for, not the other.
    expect(paidThrough(week, 40000)).toEqual({ paidThrough: '2026-10-24', creditCents: 10000 });
  });

  it('ignores input order', () => {
    expect(paidThrough([...week].reverse(), 50000).paidThrough).toBe('2026-10-25');
  });

  it('carries anything paid past the last session as credit', () => {
    expect(paidThrough(week, 52500)).toEqual({ paidThrough: '2026-10-25', creditCents: 2500 });
  });
});

describe('quotePayDay', () => {
  it("covers the weekend that has not happened yet — the Friday envelope", () => {
    // Paid through Tuesday; filling the envelope for everything through Sunday.
    const q = quotePayDay(week, 10000, '2026-10-25');
    expect(q.sessions.map((x) => x.date)).toEqual([
      '2026-10-22',
      '2026-10-24',
      '2026-10-25',
      '2026-10-25',
    ]);
    expect(q.sessionsCents).toBe(40000);
    expect(q.owedCents).toBe(40000);
  });

  it('nets off credit from a part-paid day', () => {
    const q = quotePayDay(week, 40000, '2026-10-25');
    expect(q.sessions).toHaveLength(2);
    expect(q.sessionsCents).toBe(20000);
    expect(q.creditCents).toBe(10000);
    expect(q.owedCents).toBe(10000);
  });

  it('is negative when already paid past the pay day', () => {
    const q = quotePayDay(week, 50000, '2026-10-22');
    expect(q.sessions).toEqual([]);
    expect(q.owedCents).toBe(-30000);
  });

  it('moves back when a covered session is cancelled', () => {
    // Paid through Sunday, then the Saturday game is cancelled (dropped).
    const live = week.filter((x) => x.date !== '2026-10-24');
    expect(paidThrough(live, 50000)).toEqual({ paidThrough: '2026-10-25', creditCents: 10000 });
    expect(quotePayDay(live, 50000, '2026-10-25').owedCents).toBe(-10000);
  });
});
