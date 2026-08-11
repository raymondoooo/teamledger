// Splitting a team bill across players almost never divides evenly. The
// spreadsheet papered over this by showing every player $271.67 when the true
// share of $4,075.00 across 15 is $271.6666… — 15 × $271.67 is $4,075.05, so
// the sheet quietly over-collected five cents.
//
// splitEvenly keeps the total exact: it gives everyone the floor share and
// hands the leftover pennies out one at a time. The result always sums to the
// input, which is what makes the ledger reconcile against the bank.
export function splitEvenly(totalCents: number, ways: number): number[] {
  if (ways <= 0) return [];
  const sign = totalCents < 0 ? -1 : 1;
  const magnitude = Math.abs(totalCents);
  const base = Math.floor(magnitude / ways);
  const remainder = magnitude - base * ways;
  return Array.from({ length: ways }, (_, i) => sign * (base + (i < remainder ? 1 : 0)));
}

// The per-player figure to *display* when quoting one number for the whole
// team ("dues are $271.67"). Rounded up so the quoted price never collects
// less than the team actually needs.
export function quotedShareCents(totalCents: number, ways: number): number {
  if (ways <= 0) return 0;
  return Math.ceil(totalCents / ways);
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  // Thousands separators matter here: these strings go straight onto the PDF a
  // parent reads, and "$3000.00" next to "$300.00" is easy to misread.
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const fraction = String(abs % 100).padStart(2, '0');
  return `${sign}$${whole}.${fraction}`;
}

// Accepts what a human types into a money field: "271.67", "$271.67", "1,234",
// "(50)" for negative. Returns null when it isn't money at all, so callers can
// reject rather than silently storing a 0.
export function parseMoneyToCents(input: string | number): number | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.round(input * 100) : null;
  }
  const trimmed = input.trim();
  if (!trimmed) return null;
  const negative = /^\(.*\)$/.test(trimmed) || trimmed.startsWith('-');
  const cleaned = trimmed.replace(/[($),\s-]/g, '');
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) * (negative ? -1 : 1);
}
