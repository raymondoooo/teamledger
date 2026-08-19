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

// Spreads one player's dues across the season's instalments.
//
// An instalment with a fixed amount is honoured first, in order, and capped by
// what is still unpaid — so pinning "$150 deposit" works even for a player on a
// $100 scholarship rate, who simply owes $100 and nothing after. Whatever those
// leave behind is split evenly across the instalments that have no fixed
// amount, using splitEvenly so the parts still sum to the dues exactly.
//
// If every instalment is pinned and they do not add up to the dues, the last
// one absorbs the difference: money a player owes has to appear somewhere, and
// silently dropping it is how a ledger stops reconciling.
export function allocateInstalments(
  duesCents: number,
  amounts: (number | null)[],
): number[] {
  if (amounts.length === 0) return [];

  const out = new Array<number>(amounts.length).fill(0);
  const flexible: number[] = [];
  let left = duesCents;

  amounts.forEach((amount, i) => {
    if (amount === null) {
      flexible.push(i);
      return;
    }
    // Never allocate more than remains, and never a negative instalment.
    const take = Math.max(0, Math.min(amount, Math.max(0, left)));
    out[i] = take;
    left -= take;
  });

  if (flexible.length > 0) {
    const shares = splitEvenly(left, flexible.length);
    flexible.forEach((i, k) => {
      out[i] = shares[k];
    });
  } else if (left !== 0) {
    out[out.length - 1] += left;
  }

  return out;
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
