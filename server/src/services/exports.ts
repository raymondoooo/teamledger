import { existsSync } from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { PlayerBalance, SeasonBudget } from './budget.js';
import { formatCents } from './money.js';

// pdfkit's built-in Helvetica is WinAnsi-encoded: it can only represent
// Latin-1. A roster is full of names that are not — Łukasz, Ольga, Nguyễn — and
// those came out as mojibake in a statement emailed to a parent, with the PDF
// still returning 200 so nothing flagged it.
//
// DejaVu Sans is embedded instead. It covers Latin (incl. Eastern European),
// Cyrillic and Greek. CJK is not covered by any reasonably sized font, so those
// glyphs render as blanks rather than as garbage — wrong, but visibly wrong.
const FONT_DIR = process.env.FONT_DIR ?? path.resolve(process.cwd(), 'fonts');
const UNICODE_FONTS = {
  regular: path.join(FONT_DIR, 'DejaVuSans.ttf'),
  bold: path.join(FONT_DIR, 'DejaVuSans-Bold.ttf'),
};
// Falls back to the built-in faces when the fonts are absent, so `npm run dev`
// on a machine without them still produces a (Latin-1) PDF rather than failing.
export const hasUnicodeFonts =
  existsSync(UNICODE_FONTS.regular) && existsSync(UNICODE_FONTS.bold);

const FONT = { regular: 'Helvetica', bold: 'Helvetica-Bold' };

function newDoc(): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
  if (hasUnicodeFonts) {
    doc.registerFont('body', UNICODE_FONTS.regular);
    doc.registerFont('body-bold', UNICODE_FONTS.bold);
    FONT.regular = 'body';
    FONT.bold = 'body-bold';
  }
  return doc;
}

// Exports exist so the books can leave the app: a CSV the next treasurer can
// open in whatever they use, and a PDF that reads like the budget page a
// treasurer would hand round at a parents' meeting.
//
// PDF generation is pdfkit rather than headless Chrome on purpose — this image
// is meant to be pulled by strangers from GitHub, and Chromium would roughly
// triple its size for two documents of tables.

const CATEGORY_LABELS: Record<string, string> = {
  training: 'Training',
  ref_fees: 'Ref Fees',
  tournaments: 'Tournaments',
  jerseys: 'Jersey Costs',
  misc: 'Misc.',
};

const CREDIT_LABELS: Record<string, string> = {
  credit: 'Credits',
  fundraiser: 'Fundraisers',
  sponsor: 'Sponsors',
};

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  // Excel opens a bare UTF-8 CSV as Windows-1252 and mangles any accented
  // player name; the BOM is what makes it read the file correctly.
  const lines = [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

// Money as a plain decimal, no currency symbol or thousands separator, so
// spreadsheets read the column as numbers rather than text.
const csvMoney = (cents: number) => (cents / 100).toFixed(2);

export function rosterCsv(budget: SeasonBudget): string {
  return toCsv(
    ['Player', 'Jersey', 'Parent Email', 'Venmo', 'Dues', 'Paid', 'Balance'],
    budget.playerBalances.map((p) => [
      p.name,
      p.jerseyNumber ?? '',
      p.parentEmail ?? '',
      p.venmoHandle ?? '',
      csvMoney(p.duesCents),
      csvMoney(p.paidCents),
      csvMoney(p.balanceCents),
    ]),
  );
}

export function ledgerCsv(budget: SeasonBudget): string {
  const rows: unknown[][] = [];
  for (const player of budget.playerBalances) {
    for (const payment of player.payments) {
      rows.push([
        payment.paidAt,
        player.name,
        csvMoney(payment.amountCents),
        payment.method,
        payment.note ?? '',
      ]);
    }
  }
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return toCsv(['Date', 'Player', 'Amount', 'Method', 'Note'], rows);
}

export function budgetCsv(budget: SeasonBudget): string {
  const rows: unknown[][] = [];
  for (const category of budget.expensesByCategory) {
    for (const line of category.lines) {
      rows.push([
        'Expense',
        CATEGORY_LABELS[category.category] ?? category.category,
        line.label,
        csvMoney(line.amountCents),
        line.source,
      ]);
    }
  }
  for (const kind of budget.creditsByKind) {
    for (const line of kind.lines) {
      rows.push([
        'Credit',
        CREDIT_LABELS[kind.category] ?? kind.category,
        line.label,
        csvMoney(line.amountCents),
        line.source,
      ]);
    }
  }
  rows.push([]);
  rows.push(['Total', 'Expenses', '', csvMoney(budget.totalExpensesCents), '']);
  rows.push(['Total', 'Credits', '', csvMoney(budget.totalCreditsCents), '']);
  rows.push(['Total', 'Net due from team', '', csvMoney(budget.netDueCents), '']);
  rows.push(['Total', 'Per player', '', csvMoney(budget.quotedPerPlayerCents), '']);
  return toCsv(['Type', 'Category', 'Label', 'Amount', 'Source'], rows);
}

export function balancesCsv(budget: SeasonBudget): string {
  return toCsv(
    ['Player', 'Share', 'Carried In', 'Raised', 'Dues', 'Paid', 'Balance', 'Status'],
    budget.playerBalances.map((p) => [
      p.name,
      csvMoney(p.shareCents),
      csvMoney(p.carriedBalanceCents),
      csvMoney(p.raisedCents),
      csvMoney(p.duesCents),
      csvMoney(p.paidCents),
      csvMoney(p.balanceCents),
      p.balanceCents > 0 ? 'Owes' : p.balanceCents < 0 ? 'Overpaid' : 'Settled',
    ]),
  );
}

// The bank ledger as a spreadsheet: separate In/Out columns and a running
// balance, matching how a statement reads rather than the signed integer the
// database stores.
export function bankLedgerCsv(ledger: {
  name: string;
  startingBalanceCents: number;
  startingOn: string | null;
  lines: {
    occurredOn: string;
    description: string;
    amountCents: number;
    kind: string;
    reconciled: boolean;
    balanceCents: number;
  }[];
}): string {
  const rows: unknown[][] = [
    [ledger.startingOn ?? '', 'Starting balance', '', '', csvMoney(ledger.startingBalanceCents), ''],
  ];
  for (const l of ledger.lines) {
    rows.push([
      l.occurredOn,
      l.description,
      l.amountCents > 0 ? csvMoney(l.amountCents) : '',
      l.amountCents < 0 ? csvMoney(-l.amountCents) : '',
      csvMoney(l.balanceCents),
      l.reconciled ? 'yes' : 'no',
    ]);
  }
  return toCsv(['Date', 'Description', 'In', 'Out', 'Balance', 'Reconciled'], rows);
}

type PdfMeta = { teamName: string; seasonLabel: string };

// pdfkit's built-in Helvetica is WinAnsi-encoded, so anything outside Latin-1
// (em dashes, curly quotes, the × we put in derived expense labels) silently
// drops out of the rendered page. Everything written into a PDF goes through
// here rather than relying on whoever typed the label to avoid them.
// With a Unicode font embedded these characters render correctly, so nothing is
// substituted. The mapping stays for the fallback path, where the built-in
// WinAnsi faces would silently drop them.
function pdfText(value: string): string {
  if (hasUnicodeFonts) return value;
  return value
    .replace(/[—–]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/×/g, 'x')
    .replace(/…/g, '...');
}

function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function moneyRow(
  doc: PDFKit.PDFDocument,
  label: string,
  amount: string,
  opts: { bold?: boolean; indent?: number } = {},
) {
  const left = doc.page.margins.left + (opts.indent ?? 0);
  const right = doc.page.width - doc.page.margins.right;
  doc.font(opts.bold ? FONT.bold : FONT.regular).fontSize(10);
  const y = doc.y;
  doc.text(pdfText(label), left, y, { width: right - left - 90 });
  doc.text(pdfText(amount), right - 90, y, { width: 90, align: 'right' });
  doc.moveDown(0.3);
}

function sectionHeader(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.5);
  doc.font(FONT.bold).fontSize(11).fillColor('#000').text(pdfText(title));
  const y = doc.y + 2;
  doc
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .strokeColor('#999')
    .stroke();
  doc.moveDown(0.4);
}

export async function budgetPdf(budget: SeasonBudget, meta: PdfMeta): Promise<Buffer> {
  const doc = newDoc();

  doc.font(FONT.bold).fontSize(16).text(pdfText(meta.teamName));
  doc.font(FONT.regular).fontSize(11).fillColor('#444').text(pdfText(`${meta.seasonLabel} — Team Budget`));
  doc.fillColor('#000');
  doc.moveDown(0.5);

  sectionHeader(doc, 'Expenses');
  for (const category of budget.expensesByCategory) {
    moneyRow(doc, CATEGORY_LABELS[category.category] ?? category.category, formatCents(category.amountCents), {
      bold: true,
    });
    for (const line of category.lines) {
      moneyRow(doc, line.label, formatCents(line.amountCents), { indent: 16 });
    }
  }
  moneyRow(doc, 'Total Expenses', formatCents(budget.totalExpensesCents), { bold: true });

  sectionHeader(doc, 'Credits');
  if (budget.creditsByKind.length === 0) {
    doc.font(FONT.regular).fontSize(10).fillColor('#666').text('None').fillColor('#000');
    doc.moveDown(0.3);
  }
  for (const kind of budget.creditsByKind) {
    moneyRow(doc, CREDIT_LABELS[kind.category] ?? kind.category, formatCents(kind.amountCents), {
      bold: true,
    });
    for (const line of kind.lines) {
      moneyRow(doc, line.label, formatCents(line.amountCents), { indent: 16 });
    }
  }
  moneyRow(doc, 'Total Credits', formatCents(budget.totalCreditsCents), { bold: true });

  sectionHeader(doc, 'Summary');
  moneyRow(doc, 'Total Expenses minus Credits', formatCents(budget.netDueCents), { bold: true });
  moneyRow(doc, `Players rostered`, String(budget.rosterCount));
  moneyRow(doc, 'Total Due Per Player', formatCents(budget.quotedPerPlayerCents), { bold: true });
  if (budget.totalPlayerRaisedCents !== 0) {
    moneyRow(doc, 'Player fundraising (credited individually)', formatCents(budget.totalPlayerRaisedCents));
  }
  moneyRow(doc, 'Collected to date', formatCents(budget.totalCollectedCents));
  moneyRow(doc, 'Still outstanding', formatCents(budget.totalOutstandingCents), { bold: true });

  sectionHeader(doc, 'Player Balances');
  moneyRow(doc, 'Player', 'Balance', { bold: true });
  for (const p of budget.playerBalances) {
    const status = p.balanceCents > 0 ? '' : p.balanceCents < 0 ? ' (overpaid)' : ' (paid)';
    moneyRow(doc, `${p.name}${status}`, formatCents(p.balanceCents), { indent: 16 });
  }

  doc
    .moveDown(1)
    .font(FONT.regular)
    .fontSize(8)
    .fillColor('#888')
    .text(`Generated ${new Date().toISOString().slice(0, 10)} by teamledger`);

  return pdfToBuffer(doc);
}

// The one-pager: each cost category with what the team owes and what that works
// out to per player, then credits and the payment split. Deliberately shows no
// individual player — this is the sheet you hand round at a parents' meeting,
// where per-player balances would be nobody else's business.
export async function budgetSheetPdf(budget: SeasonBudget, meta: PdfMeta): Promise<Buffer> {
  const doc = newDoc();
  const n = budget.rosterCount || 1;
  const perPlayer = (cents: number) => formatCents(Math.ceil(cents / n));

  doc.font(FONT.bold).fontSize(18).text(pdfText(meta.teamName), { align: 'center' });
  doc
    .font(FONT.regular)
    .fontSize(12)
    .fillColor('#444')
    .text(pdfText(`${meta.seasonLabel} Budget`), { align: 'center' });
  doc.fillColor('#000').moveDown(0.8);

  // Column header for the two money columns, so the numbers below are readable
  // without a legend.
  const right = doc.page.width - doc.page.margins.right;
  doc.font(FONT.bold).fontSize(9).fillColor('#666');
  const headY = doc.y;
  // Short labels: "TOTAL DUE FROM TEAM" wraps to two lines in a 100pt column.
  doc.text('TEAM TOTAL', right - 200, headY, { width: 100, align: 'right' });
  doc.text('PER PLAYER', right - 95, headY, { width: 95, align: 'right' });
  doc.fillColor('#000').moveDown(1.2);

  const twoColumnRow = (
    label: string,
    total: number,
    opts: { bold?: boolean; indent?: number; showPerPlayer?: boolean } = {},
  ) => {
    const left = doc.page.margins.left + (opts.indent ?? 0);
    doc.font(opts.bold ? FONT.bold : FONT.regular).fontSize(10);
    const y = doc.y;
    doc.text(pdfText(label), left, y, { width: right - left - 205 });
    doc.text(formatCents(total), right - 200, y, { width: 100, align: 'right' });
    if (opts.showPerPlayer !== false) {
      doc.text(perPlayer(total), right - 95, y, { width: 95, align: 'right' });
    }
    doc.moveDown(0.35);
  };

  for (const category of budget.expensesByCategory) {
    sectionHeader(doc, CATEGORY_LABELS[category.category] ?? category.category);
    for (const line of category.lines) {
      const paid = line.paidOn ? ' [paid]' : '';
      twoColumnRow(`${line.label}${paid}`, line.amountCents, {
        indent: 12,
        showPerPlayer: false,
      });
    }
    twoColumnRow('Total due from team', category.amountCents, { bold: true, indent: 12 });
  }

  sectionHeader(doc, 'Credits, fundraising and sponsors');
  if (budget.creditsByKind.length === 0) {
    doc.font(FONT.regular).fontSize(10).fillColor('#666').text('None').fillColor('#000');
    doc.moveDown(0.3);
  }
  for (const kind of budget.creditsByKind) {
    twoColumnRow(CREDIT_LABELS[kind.category] ?? kind.category, kind.amountCents, {
      indent: 12,
      showPerPlayer: false,
    });
  }
  twoColumnRow('Total credits', budget.totalCreditsCents, { bold: true, indent: 12 });

  sectionHeader(doc, 'Season total');
  twoColumnRow('Total expenses for team', budget.totalExpensesCents, { showPerPlayer: false });
  twoColumnRow('Team credits', budget.totalCreditsCents, { showPerPlayer: false });
  twoColumnRow('Total expenses minus credits', budget.netDueCents, { bold: true });
  doc.moveDown(0.2);
  doc.font(FONT.regular).fontSize(10).text(pdfText(`Players rostered: ${budget.rosterCount}`));
  doc.moveDown(0.4);

  moneyRow(doc, 'Total due per player', formatCents(budget.quotedPerPlayerCents), { bold: true });

  // The instalment split, taken from a real roster line so it reflects whatever
  // the season is actually configured to do rather than being recomputed here.
  const sample = budget.playerBalances[0];
  for (const part of sample?.installments ?? []) {
    if (part.amountCents <= 0) continue;
    const due = part.dueDate ? ` (due ${part.dueDate})` : '';
    moneyRow(doc, `${part.label?.trim() || `Payment ${part.seq}`}${due}`, formatCents(part.amountCents));
  }

  sectionHeader(doc, 'Collection');
  moneyRow(doc, 'Collected to date', formatCents(budget.totalCollectedCents));
  if (budget.totalPlayerRaisedCents !== 0) {
    moneyRow(doc, 'Player fundraising', formatCents(budget.totalPlayerRaisedCents));
  }
  moneyRow(doc, 'Still outstanding', formatCents(budget.totalOutstandingCents), { bold: true });

  doc
    .moveDown(1.2)
    .font(FONT.regular)
    .fontSize(8)
    .fillColor('#888')
    .text(
      pdfText(
        `Generated ${new Date().toISOString().slice(0, 10)} by teamledger. ` +
          'Per-player figures are rounded up; exact shares vary by a cent.',
      ),
    );

  return pdfToBuffer(doc);
}

export async function playerStatementPdf(
  player: PlayerBalance,
  budget: SeasonBudget,
  meta: PdfMeta,
): Promise<Buffer> {
  const doc = newDoc();

  doc.font(FONT.bold).fontSize(16).text(pdfText(meta.teamName));
  doc
    .font(FONT.regular)
    .fontSize(11)
    .fillColor('#444')
    .text(pdfText(`${meta.seasonLabel} — Statement for ${player.name}`));
  doc.fillColor('#000');

  sectionHeader(doc, 'What you owe');
  moneyRow(doc, 'Share of team costs', formatCents(player.shareCents));
  if (player.carriedBalanceCents !== 0) {
    moneyRow(
      doc,
      player.carriedBalanceCents > 0
        ? 'Credit carried from last season'
        : 'Balance carried from last season',
      formatCents(-player.carriedBalanceCents),
    );
  }
  if (player.raisedCents !== 0) {
    moneyRow(doc, 'Less fundraising you raised', formatCents(-player.raisedCents));
  }
  moneyRow(doc, 'Total dues', formatCents(player.duesCents), { bold: true });

  sectionHeader(doc, 'Payments received');
  if (player.payments.length === 0) {
    doc.font(FONT.regular).fontSize(10).fillColor('#666').text('None yet').fillColor('#000');
    doc.moveDown(0.3);
  }
  for (const payment of player.payments) {
    const note = payment.note ? ` — ${payment.note}` : '';
    moneyRow(doc, `${payment.paidAt} (${payment.method})${note}`, formatCents(payment.amountCents), {
      indent: 16,
    });
  }
  moneyRow(doc, 'Total paid', formatCents(player.paidCents), { bold: true });

  sectionHeader(doc, 'Balance');
  const owing = player.balanceCents > 0;
  moneyRow(
    doc,
    owing ? 'Still due' : player.balanceCents < 0 ? 'Overpaid — refund owed' : 'Paid in full',
    formatCents(Math.abs(player.balanceCents)),
    { bold: true },
  );

  // The plan as it applies to this player — their own amounts, not the team's,
  // since an override or a carried balance changes every figure.
  const plan = (player.installments ?? []).filter((i) => i.amountCents > 0);
  if (owing && plan.length > 1) {
    doc.moveDown(0.5);
    doc.font(FONT.regular).fontSize(9).fillColor('#444');
    const parts = plan.map((i) => {
      const name = i.label?.trim() || `payment ${i.seq}`;
      const when = i.dueDate ? ` by ${i.dueDate}` : '';
      const done = i.paid ? ' — paid' : '';
      return `${formatCents(i.amountCents)} ${name}${when}${done}`;
    });
    doc.text(pdfText(`Payment plan: ${parts.join('; ')}.`));
    doc.fillColor('#000');
  }

  if (player.venmoHandle) {
    doc.moveDown(0.5).font(FONT.regular).fontSize(10).text(pdfText(`Venmo: ${player.venmoHandle}`));
  }

  doc
    .moveDown(1)
    .font(FONT.regular)
    .fontSize(8)
    .fillColor('#888')
    .text(
      pdfText(
        `Team total this season ${formatCents(budget.netDueCents)} across ${budget.rosterCount} players. ` +
          `Generated ${new Date().toISOString().slice(0, 10)} by teamledger.`,
      ),
    );

  return pdfToBuffer(doc);
}
