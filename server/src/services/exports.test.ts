import { describe, expect, it } from 'vitest';
import type { PlayerBalance, SeasonBudget } from './budget.js';
import {
  balancesCsv,
  budgetPdf,
  budgetSheetPdf,
  hasUnicodeFonts,
  playerStatementPdf,
  rosterCsv,
} from './exports.js';

// Names that broke the PDF export: pdfkit's built-in Helvetica is WinAnsi-only,
// so anything outside Latin-1 came out as mojibake in a document emailed to a
// parent — and the request still returned 200, so nothing flagged it.
const NAMES = [
  'José Ramírez-Fernández',
  'Łukasz Wiśniewski',
  'Ольга Петрова',
  'Aoife Ní Bhraonáin',
  'Nguyễn Thị Hương',
  'A Very Extremely Long Hyphenated Surname That Keeps Going And Going',
];

function player(name: string, i: number): PlayerBalance {
  return {
    playerId: i + 1,
    seasonPlayerId: i + 1,
    name,
    jerseyNumber: String(i + 1),
    parentEmail: `p${i}@example.com`,
    venmoHandle: `@p${i}`,
    duesCents: 27167,
    shareCents: 27167,
    carriedBalanceCents: 0,
    raisedCents: 0,
    credits: [],
    hasOverride: false,
    paidCents: 15000,
    balanceCents: 12167,
    installments: [
      { id: 1, seq: 1, label: 'Deposit', dueDate: '2026-09-30', amountCents: 15000, paid: true },
      { id: 2, seq: 2, label: null, dueDate: '2026-11-15', amountCents: 12167, paid: false },
    ],
    payments: [
      { id: i + 1, paidAt: '2026-02-15', amountCents: 15000, method: 'venmo', installment: 'first', note: null, transferredOn: null },
    ],
  };
}

const budget: SeasonBudget = {
  seasonId: 1,
  rosterCount: NAMES.length,
  expensesByCategory: [
    {
      category: 'training',
      amountCents: 300000,
      lines: [{ id: 1, label: 'Sam (12 × 200.00)', amountCents: 300000, source: 'derived', paidOn: null }],
    },
  ],
  totalExpensesCents: 300000,
  creditsByKind: [],
  totalCreditsCents: 0,
  netDueCents: 300000,
  quotedPerPlayerCents: 27167,
  totalPlayerRaisedCents: 0,
  totalCollectedCents: 90000,
  totalOutstandingCents: 73002,
  playerBalances: NAMES.map(player),
};

const meta = { teamName: 'Kraków Wanderers Söccer Club', seasonLabel: 'Spring 2026' };

const isPdf = (b: Buffer) => b.subarray(0, 4).toString() === '%PDF';

describe('PDF exports', () => {
  it('renders a budget report containing non-Latin-1 names', async () => {
    const pdf = await budgetPdf(budget, meta);
    expect(isPdf(pdf)).toBe(true);
    // With the font embedded the subset makes the file an order of magnitude
    // bigger. Only asserted where the font is actually present, so the suite
    // still passes on a dev machine that has no /app/fonts.
    if (hasUnicodeFonts) expect(pdf.length).toBeGreaterThan(10_000);
  });

  it('renders the one-page budget sheet', async () => {
    const pdf = await budgetSheetPdf(budget, meta);
    expect(isPdf(pdf)).toBe(true);
  });

  it('renders a player statement for a Cyrillic name', async () => {
    const cyrillic = budget.playerBalances.find((p) => p.name === 'Ольга Петрова')!;
    const pdf = await playerStatementPdf(cyrillic, budget, meta);
    expect(isPdf(pdf)).toBe(true);
  });

  it('embeds a Unicode font when one is available', async () => {
    const pdf = await budgetPdf(budget, meta);
    // Inside the image the font must genuinely be embedded — that is the whole
    // fix. Outside it, the fallback must still produce a valid PDF rather than
    // throwing, which is what a contributor running `npm test` will hit.
    if (hasUnicodeFonts) {
      expect(pdf.includes('DejaVu')).toBe(true);
    } else {
      expect(isPdf(pdf)).toBe(true);
    }
  });
});

describe('CSV exports', () => {
  it('keeps non-Latin-1 names intact and BOM-prefixed for Excel', () => {
    const csv = rosterCsv(budget);
    expect(csv.startsWith('﻿')).toBe(true);
    for (const name of NAMES) expect(csv).toContain(name);
  });

  it('quotes a name containing a comma rather than splitting the row', () => {
    const withComma = { ...budget, playerBalances: [player('Smith, Jr., Bob', 0)] };
    const csv = balancesCsv(withComma);
    expect(csv).toContain('"Smith, Jr., Bob"');
    // Header plus exactly one data row — a naive writer would have made three.
    expect(csv.trimEnd().split('\r\n')).toHaveLength(2);
  });
});
