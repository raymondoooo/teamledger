// Thin fetch wrapper. Session lives in an httpOnly cookie, so there is no token
// to attach — but credentials must be included or the browser drops it on
// same-origin XHR in some configurations.

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export type Team = {
  id: number;
  name: string;
  club: string | null;
  ageGroup: string | null;
  sport: string;
  venmoHandle: string | null;
};

export type Season = {
  id: number;
  teamId: number;
  term: 'fall' | 'spring' | 'summer' | 'winter';
  year: number;
  name: string | null;
  startDate: string | null;
  endDate: string | null;
  status: 'active' | 'closed';
  firstPaymentCents: number | null;
  firstPaymentDue: string | null;
  finalPaymentDue: string | null;
};

export type BudgetLine = {
  id: number;
  label: string;
  amountCents: number;
  source: string;
  paidOn?: string | null;
};
export type CategoryTotal = { category: string; amountCents: number; lines: BudgetLine[] };

export type PlayerBalance = {
  playerId: number;
  seasonPlayerId: number;
  name: string;
  jerseyNumber: string | null;
  parentEmail: string | null;
  venmoHandle: string | null;
  duesCents: number;
  shareCents: number;
  carriedBalanceCents: number;
  raisedCents: number;
  credits: { id: number; label: string; amountCents: number; receivedOn: string | null }[];
  hasOverride: boolean;
  paidCents: number;
  balanceCents: number;
  firstPaymentDueCents: number;
  finalPaymentDueCents: number;
  payments: {
    id: number;
    paidAt: string;
    amountCents: number;
    method: string;
    installment: string;
    note: string | null;
    transferredOn: string | null;
  }[];
  firstPaid: boolean;
  finalPaid: boolean;
};

export type SeasonBudget = {
  seasonId: number;
  rosterCount: number;
  expensesByCategory: CategoryTotal[];
  totalExpensesCents: number;
  creditsByKind: CategoryTotal[];
  totalCreditsCents: number;
  netDueCents: number;
  quotedPerPlayerCents: number;
  totalPlayerRaisedCents: number;
  totalCollectedCents: number;
  totalOutstandingCents: number;
  playerBalances: PlayerBalance[];
};

export type Trainer = {
  id: number;
  teamId: number;
  name: string;
  initials: string | null;
  defaultRateCents: number;
  rateUnit: 'per_session' | 'flat';
  isPrimary: boolean;
  expectedSessions: number;
  active: boolean;
};

export type CostRule = {
  id: number;
  seasonId: number;
  kind: 'ref_fee' | 'training';
  label: string;
  eventType: 'game' | 'practice' | 'tournament' | 'other';
  trainerId: number | null;
  amountCents: number;
  unit: 'per_session' | 'flat';
  expectedCount: number;
  active: boolean;
};

export type Tournament = {
  id: number;
  seasonId: number;
  name: string;
  startDate: string | null;
  endDate: string | null;
  registrationCents: number;
  estimated: boolean;
  paidOn: string | null;
  note: string | null;
};

export type EventCharge = {
  id: number;
  eventId: number;
  ruleId: number | null;
  trainerId: number | null;
  amountCents: number;
  overridden: boolean;
  note: string | null;
};

export type TeamEvent = {
  id: number;
  title: string;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  type: 'game' | 'practice' | 'tournament' | 'other';
  typeConfirmed: boolean;
  cancelled: boolean;
  source: 'ical' | 'manual';
  trainerId: number | null;
  trainerName: string | null;
  charges: EventCharge[];
  costCents: number;
};

export type Feed = {
  id: number;
  seasonId: number;
  url: string;
  label: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export type BankLedgerLine = {
  id: number;
  occurredOn: string;
  description: string;
  amountCents: number;
  kind: string;
  reconciled: boolean;
  note: string | null;
  balanceCents: number;
};

export type BankLedger = {
  accountId: number;
  name: string;
  startingBalanceCents: number;
  startingOn: string | null;
  lines: BankLedgerLine[];
  balanceCents: number;
  reconciledBalanceCents: number;
  untransferredCents: number;
  untransferredCount: number;
};

export type UntransferredPayment = {
  id: number;
  seasonId: number;
  playerName: string;
  paidAt: string;
  amountCents: number;
  method: string;
  note: string | null;
};

export type TrainerLedgerRow = {
  trainerId: number;
  name: string;
  rateCents: number;
  completedSessions: number;
  scheduledSessions: number;
  billedSessions: number;
  earnedToDateCents: number;
  forecastCents: number;
  paidCents: number;
  owedCents: number;
  payments: { id: number; paidOn: string; amountCents: number; method: string; note: string | null }[];
};

export type RosterRow = {
  seasonPlayerId: number;
  playerId: number;
  name: string;
  parentName: string | null;
  parentEmail: string | null;
  parentPhone: string | null;
  venmoHandle: string | null;
  jerseyNumber: string | null;
  size: string | null;
  duesOverrideCents: number | null;
  carriedBalanceCents: number;
};

// Display helpers, kept beside the types so every screen formats money the
// same way.
// Mirrors formatCents() on the server so a figure reads identically on screen
// and in the PDF — "$4,350.00" in one place and "$4350.00" in the other looks
// like two different numbers at a glance.
export const fmt = (cents: number) => {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const fraction = String(abs % 100).padStart(2, '0');
  return `${sign}$${whole}.${fraction}`;
};

export const parseMoney = (input: string): number | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const negative = /^\(.*\)$/.test(trimmed) || trimmed.startsWith('-');
  const cleaned = trimmed.replace(/[($),\s-]/g, '');
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) * (negative ? -1 : 1) : null;
};

// A season is keyed by term and year, but that is not always what it is called
// — a club billing annually wants "2026-2027 Season". The name wins wherever a
// season is shown; the server does the same for PDF and CSV exports.
export const seasonLabel = (s: Season) =>
  s.name?.trim()
    ? s.name.trim()
    : `${s.term.charAt(0).toUpperCase()}${s.term.slice(1)} ${s.year}`;
