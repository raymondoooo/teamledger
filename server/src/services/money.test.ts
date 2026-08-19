import { describe, expect, it } from 'vitest';
import {
  allocateInstalments,
  formatCents,
  parseMoneyToCents,
  quotedShareCents,
  splitEvenly,
} from './money.js';

describe('splitEvenly', () => {
  it('splits a season total without losing or inventing a cent', () => {
    // $4,075.00 across 15 players. The spreadsheet showed $271.67 for everyone,
    // which multiplies back to $4,075.05 — five cents the team never owed.
    const shares = splitEvenly(407500, 15);
    expect(shares).toHaveLength(15);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(407500);
    // Ten players pay the extra penny, five pay the floor.
    expect(shares.filter((s) => s === 27167)).toHaveLength(10);
    expect(shares.filter((s) => s === 27166)).toHaveLength(5);
  });

  it('splits evenly when it divides cleanly', () => {
    expect(splitEvenly(30000, 15)).toEqual(Array(15).fill(2000));
  });

  it('handles a negative total (a refund owed to the team)', () => {
    const shares = splitEvenly(-1000, 3);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(-1000);
  });

  it('returns nothing for an empty roster rather than dividing by zero', () => {
    expect(splitEvenly(407500, 0)).toEqual([]);
  });
});

describe('quotedShareCents', () => {
  it('rounds up so the quoted price never under-collects', () => {
    expect(quotedShareCents(407500, 15)).toBe(27167);
  });

  it('is exact when it divides cleanly', () => {
    expect(quotedShareCents(67500, 15)).toBe(4500);
  });

  it('is zero for an empty roster', () => {
    expect(quotedShareCents(407500, 0)).toBe(0);
  });
});

describe('parseMoneyToCents', () => {
  it('accepts the shapes a treasurer actually types', () => {
    expect(parseMoneyToCents('271.67')).toBe(27167);
    expect(parseMoneyToCents('$271.67')).toBe(27167);
    expect(parseMoneyToCents('1,234.50')).toBe(123450);
    expect(parseMoneyToCents('3000')).toBe(300000);
    expect(parseMoneyToCents(45)).toBe(4500);
  });

  it('reads parentheses and a leading minus as negative', () => {
    expect(parseMoneyToCents('(50)')).toBe(-5000);
    expect(parseMoneyToCents('-10.33')).toBe(-1033);
  });

  it('rejects junk instead of silently storing zero', () => {
    expect(parseMoneyToCents('')).toBeNull();
    expect(parseMoneyToCents('abc')).toBeNull();
    expect(parseMoneyToCents('.')).toBeNull();
    expect(parseMoneyToCents('12.34.56')).toBeNull();
  });
});

describe('formatCents', () => {
  it('formats both directions of a balance', () => {
    expect(formatCents(27167)).toBe('$271.67');
    expect(formatCents(-1033)).toBe('-$10.33');
    expect(formatCents(0)).toBe('$0.00');
  });

  it('groups thousands so a PDF total is not misread', () => {
    expect(formatCents(300000)).toBe('$3,000.00');
    expect(formatCents(407500)).toBe('$4,075.00');
    expect(formatCents(-123456789)).toBe('-$1,234,567.89');
  });

  it('pads the cents rather than truncating them', () => {
    expect(formatCents(1005)).toBe('$10.05');
    expect(formatCents(1000)).toBe('$10.00');
  });
});

describe('allocateInstalments', () => {
  it('splits evenly when nothing is pinned, to the exact cent', () => {
    const parts = allocateInstalments(60834, [null, null, null, null]);
    expect(parts).toEqual([15209, 15209, 15208, 15208]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(60834);
  });

  it('honours pinned amounts and splits the remainder across the rest', () => {
    const parts = allocateInstalments(60834, [15000, null, null, null]);
    expect(parts).toEqual([15000, 15278, 15278, 15278]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(60834);
  });

  it('handles two pinned instalments', () => {
    const parts = allocateInstalments(60834, [20000, 20000, null, null]);
    expect(parts).toEqual([20000, 20000, 10417, 10417]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(60834);
  });

  // A scholarship player owes less than the deposit everyone else pays.
  it('caps a pinned instalment at what the player actually owes', () => {
    const parts = allocateInstalments(10000, [15000, null, null]);
    expect(parts).toEqual([10000, 0, 0]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it('gives the last instalment the difference when every one is pinned', () => {
    const parts = allocateInstalments(60834, [20000, 20000, 20000]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(60834);
    expect(parts[2]).toBe(20834);
  });

  it('never leaves a player owing more or less than their dues', () => {
    for (const dues of [0, 1, 99, 60834, 100000]) {
      for (const plan of [[null], [null, null], [15000, null, null], [5000, 5000]]) {
        const parts = allocateInstalments(dues, plan as (number | null)[]);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(dues);
      }
    }
  });

  it('is empty for a season with no instalments', () => {
    expect(allocateInstalments(60834, [])).toEqual([]);
  });
});
