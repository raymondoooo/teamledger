// "I'm paid up through Sunday" — the question a treasurer actually asks when
// stuffing a trainer's envelope on a Friday for a weekend that has not happened
// yet.
//
// Nothing extra is stored to answer it. Payments are money, sessions are dated
// money, so walking the sessions in date order and spending the payments
// against them tells you which day the money runs out on. That keeps it right
// when a covered game is later cancelled or re-priced: the paid-through date
// simply moves back and the difference shows up as credit, instead of a stored
// "covers through" field quietly going stale.
//
// Whole days only. Paying for Saturday but not Sunday's game on the same day is
// not "paid through Sunday", so a day is covered only once every session on it
// is; anything paid beyond the last whole day is reported as credit carried
// into the next one.

export type DatedSession = {
  eventId: number;
  // Plain 'YYYY-MM-DD' in the server's time zone, same as every calendar date.
  date: string;
  title: string;
  amountCents: number;
};

export type PayThrough = {
  // Last day whose sessions are fully paid for. Null when the payments do not
  // yet cover the first day with a session.
  paidThrough: string | null;
  // Paid beyond `paidThrough` — part of the next day's sessions, or money paid
  // ahead of anything on the calendar.
  creditCents: number;
};

export type PayDayQuote = {
  payDay: string;
  // Sessions after `paidThrough`, up to and including the pay day.
  sessions: DatedSession[];
  sessionsCents: number;
  // Already paid toward those sessions (the carried credit). Can exceed
  // sessionsCents when money was paid ahead past the pay day.
  creditCents: number;
  // What goes in the envelope. Negative means already paid past the pay day.
  owedCents: number;
};

function byDate(sessions: DatedSession[]): DatedSession[] {
  return [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.eventId - b.eventId);
}

export function paidThrough(sessions: DatedSession[], paidCents: number): PayThrough {
  const sorted = byDate(sessions);
  let covered: string | null = null;
  let spent = 0;
  let i = 0;
  while (i < sorted.length) {
    const day = sorted[i].date;
    let dayCents = 0;
    while (i < sorted.length && sorted[i].date === day) dayCents += sorted[i++].amountCents;
    if (spent + dayCents > paidCents) break;
    spent += dayCents;
    covered = day;
  }
  return { paidThrough: covered, creditCents: paidCents - spent };
}

export function quotePayDay(sessions: DatedSession[], paidCents: number, payDay: string): PayDayQuote {
  const { paidThrough: through, creditCents } = paidThrough(sessions, paidCents);
  const window = byDate(sessions).filter(
    (s) => (through === null || s.date > through) && s.date <= payDay,
  );
  const sessionsCents = window.reduce((s, x) => s + x.amountCents, 0);
  // Equivalent to "earned through the pay day minus everything paid", which is
  // what makes it negative when the pay day is already behind paidThrough.
  const earnedThrough = sessions
    .filter((s) => s.date <= payDay)
    .reduce((s, x) => s + x.amountCents, 0);
  return {
    payDay,
    sessions: window,
    sessionsCents,
    creditCents,
    owedCents: earnedThrough - paidCents,
  };
}
