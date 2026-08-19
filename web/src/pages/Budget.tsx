import { useCallback, useEffect, useState } from 'react';
import type { SeasonContext } from '../App.js';
import {
  api,
  fmt,
  parseMoney,
  type BudgetLine,
  type SeasonBudget,
  type SegmentTotals,
} from '../api.js';
import TeamMessage from '../TeamMessage.js';
import { AddSection, Collapsible } from '../ui.js';

const EXPENSE_CATEGORIES = [
  ['training', 'Training'],
  ['ref_fees', 'Ref Fees'],
  ['tournaments', 'Tournaments'],
  ['jerseys', 'Jersey Costs'],
  ['misc', 'Misc.'],
] as const;

const CREDIT_KINDS = [
  ['credit', 'Credits'],
  ['fundraiser', 'Fundraisers'],
  ['sponsor', 'Sponsors'],
] as const;

export default function Budget({ ctx }: { ctx: SeasonContext }) {
  const [budget, setBudget] = useState<SeasonBudget | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<SeasonBudget>(`/seasons/${ctx.season.id}/budget`)
      .then(setBudget)
      .catch((err: Error) => setError(err.message));
  }, [ctx.season.id]);

  useEffect(load, [load]);

  if (error) return <div className="error">{error}</div>;
  if (!budget) return <p className="muted">Loading…</p>;

  // Only worth showing a Half column when the season actually has halves.
  const split = budget.segments !== null;

  const remove = (kind: 'expenses' | 'credits', id: number) =>
    api.del(`/${kind}/${id}`).then(load).catch((err: Error) => setError(err.message));

  return (
    <>
      <AddSection
        title="Expenses"
        addLabel="+ Add expense"
        form={(close) => (
          <AddLine
            kind="expenses"
            seasonId={ctx.season.id}
            options={EXPENSE_CATEGORIES}
            field="category"
            split={split}
            onAdded={() => {
              close();
              load();
            }}
          />
        )}
      >
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Line</th>
              <th className="num">Amount</th>
              {split && <th title="Which half of the season this cost belongs to">Half</th>}
              <th>Paid</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {EXPENSE_CATEGORIES.map(([key, label]) => {
              const group = budget.expensesByCategory.find((c) => c.category === key);
              if (!group) return null;
              return group.lines.map((line, i) => (
                <tr key={line.id}>
                  <td>{i === 0 ? label : ''}</td>
                  <td>
                    {line.label}{' '}
                    {line.source === 'derived' && (
                      <span className="derived">from schedule</span>
                    )}
                  </td>
                  <td className="num">{fmt(line.amountCents)}</td>
                  {split && (
                    <td>
                      {line.source === 'manual' ? (
                        <HalfCell line={line} onChanged={load} onError={setError} />
                      ) : (
                        // Derived lines take their half from the calendar, so
                        // overriding them here would be undone on the next
                        // recalculation.
                        <span className="muted">{line.segment ?? '—'}</span>
                      )}
                    </td>
                  )}
                  <td>
                    {line.source === 'manual' ? (
                      <PaidCell line={line} onChanged={load} onError={setError} />
                    ) : (
                      <span className="derived">from schedule</span>
                    )}
                  </td>
                  <td className="num">
                    {line.source === 'manual' && (
                      <button className="link danger" onClick={() => remove('expenses', line.id)}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ));
            })}
            <tr className="subtotal">
              <td colSpan={2}>Total expenses</td>
              <td className="num">{fmt(budget.totalExpensesCents)}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
        <p className="notice">
          Lines marked “from schedule” are calculated from your cost rules and the imported
          calendar — change those on the Settings and Schedule pages. Marking a line paid writes
          the withdrawal on your bank ledger; edit the date there or here and both move together.
          Tournament fees are marked paid on the Settings page, trainers on the Bank page.
        </p>
      </AddSection>

      <AddSection
        title="Credits, fundraising and sponsors"
        addLabel="+ Add credit"
        form={(close) => (
          <AddLine
            kind="credits"
            seasonId={ctx.season.id}
            options={CREDIT_KINDS}
            field="kind"
            onAdded={() => {
              close();
              load();
            }}
          />
        )}
      >
        <table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Line</th>
              <th className="num">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {budget.creditsByKind.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">Nothing recorded yet.</td>
              </tr>
            )}
            {CREDIT_KINDS.map(([key, label]) => {
              const group = budget.creditsByKind.find((c) => c.category === key);
              if (!group) return null;
              return group.lines.map((line, i) => (
                <tr key={line.id}>
                  <td>{i === 0 ? label : ''}</td>
                  <td>{line.label}</td>
                  <td className="num">{fmt(line.amountCents)}</td>
                  <td className="num">
                    <button className="link danger" onClick={() => remove('credits', line.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ));
            })}
            <tr className="subtotal">
              <td colSpan={2}>Total credits</td>
              <td className="num">{fmt(budget.totalCreditsCents)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </AddSection>

      {budget.segments ? (
        <SegmentSummary segments={budget.segments} />
      ) : (
        <SplitPrompt budget={budget} />
      )}

      <Collapsible title="Message for the team" hint={<span className="muted">— ready to paste</span>}>
        <TeamMessage team={ctx.team} season={ctx.season} budget={budget} onTeamChange={ctx.reload} />
      </Collapsible>

      <h2>What each player owes</h2>
      <div className="panel table-wrap">
        <table>
          <tbody>
            <tr>
              <td>Total expenses</td>
              <td className="num">{fmt(budget.totalExpensesCents)}</td>
            </tr>
            <tr>
              <td>Less credits</td>
              <td className="num">−{fmt(budget.totalCreditsCents)}</td>
            </tr>
            <tr className="subtotal">
              <td>Net due from team</td>
              <td className="num">{fmt(budget.netDueCents)}</td>
            </tr>
            <tr>
              <td>Players rostered</td>
              <td className="num">{budget.rosterCount}</td>
            </tr>
            <tr className="subtotal">
              <td>Due per player</td>
              <td className="num">{fmt(budget.quotedPerPlayerCents)}</td>
            </tr>
          </tbody>
        </table>
        <PlanNote budget={budget} />
      </div>
    </>
  );
}

// Marking an expense paid writes the bank withdrawal. The date is editable
// because the day a cost is incurred is rarely the day the money leaves.
// Puts a manual cost in a half. Dated lines work themselves out, but plenty of
// costs have no useful date — a coach's fee agreed in July for the spring — and
// without this they sat under "not counted" with no way to move them.
function HalfCell({
  line,
  onChanged,
  onError,
}: {
  line: BudgetLine;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const value = line.segment ?? '';

  const set = (next: string) => {
    setBusy(true);
    api
      .patch(`/expenses/${line.id}`, { segment: next === '' ? null : next })
      .then(onChanged)
      .catch((e: Error) => onError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <select
      value={value}
      disabled={busy}
      onChange={(e) => set(e.target.value)}
      aria-label="Half of the season"
    >
      <option value="">by date</option>
      <option value="fall">Fall</option>
      <option value="spring">Spring</option>
    </select>
  );
}

// The actual payment plan, in the words of the plan itself. This used to be a
// fixed sentence about a first payment and a remainder, which stopped being
// true the moment a season could have four instalments — and went on being
// printed anyway, because it read a legacy column rather than the plan.
// A season collected across most of a year is almost certainly two halves, and
// the half-by-half check is the thing that tells you whether the autumn pays
// for itself. It is switched on by one date, which is easy to miss — so when a
// plan clearly spans a year and that date is unset, say so here rather than
// leaving the feature invisible.
function SplitPrompt({ budget }: { budget: SeasonBudget }) {
  const standard = budget.playerBalances.find((p) => !p.hasOverride) ?? budget.playerBalances[0];
  const dates = (standard?.installments ?? [])
    .map((i) => i.dueDate)
    .filter((d): d is string => Boolean(d))
    .sort();
  if (dates.length < 2) return null;

  const first = Date.parse(dates[0]);
  const last = Date.parse(dates[dates.length - 1]);
  const months = (last - first) / (1000 * 60 * 60 * 24 * 30.4);
  if (!Number.isFinite(months) || months < 5) return null;

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <p className="notice" style={{ margin: 0 }}>
        Your payments run from <strong>{dates[0]}</strong> to{' '}
        <strong>{dates[dates.length - 1]}</strong> — most of a year. Set{' '}
        <strong>spring starts</strong> on the Settings page and teamledger will split this season
        in two, showing what each half costs against what its own payments raise, so you can see
        the fall covers itself rather than borrowing from the spring.
      </p>
    </div>
  );
}

function PlanNote({ budget }: { budget: SeasonBudget }) {
  // A player on the standard rate; someone with an override owes different
  // figures and would misrepresent the plan.
  const standard = budget.playerBalances.find((p) => !p.hasOverride) ?? budget.playerBalances[0];
  const plan = standard?.installments ?? [];
  if (plan.length < 2) return null;

  const parts = plan.map((i) => {
    const name = i.label?.trim();
    const when = i.dueDate ? ` by ${i.dueDate}` : '';
    return `${fmt(i.amountCents)}${when}${name ? ` (${name})` : ''}`;
  });

  return (
    <p className="notice">
      Payment plan: {plan.length} payments — {parts.join(', ')}. Every player's own figures are on
      the roster; change the plan on the Settings page.
    </p>
  );
}

// Does each half of the season pay for itself?
//
// An annual total can look healthy while the autumn is quietly funded by money
// that does not arrive until March. This puts the two halves side by side: what
// each costs, what the instalments falling inside it add up to, and the
// difference — which is the number the treasurer actually needs before agreeing
// to a season's worth of referees.
function SegmentSummary({ segments }: { segments: SegmentTotals[] }) {
  const NAMES: Record<string, string> = {
    fall: 'Fall',
    spring: 'Spring',
    unassigned: 'Not dated',
  };
  const unassigned = segments.find((s) => s.segment === 'unassigned');
  return (
    <>
      <h2>Does each half cover itself?</h2>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th />
              <th className="num">Costs</th>
              <th className="num hide-sm">Credits</th>
              <th className="num">To raise</th>
              <th className="num">Payments due</th>
              <th className="num">Difference</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((s) => (
              <tr key={s.segment}>
                <td>{NAMES[s.segment] ?? s.segment}</td>
                <td className="num">{fmt(s.expensesCents)}</td>
                <td className="num hide-sm">{fmt(s.creditsCents)}</td>
                <td className="num">{fmt(s.netDueCents)}</td>
                <td className="num">{fmt(s.scheduledCents)}</td>
                {s.segment === 'unassigned' ? (
                  // Nothing here is "short" — it is simply not in either half
                  // yet. Showing a shortfall against costs with no date would
                  // be alarming and untrue.
                  <td className="num muted">not counted</td>
                ) : (
                  <td className={`num ${s.coverageCents < 0 ? 'owes' : 'settled'}`}>
                    {s.coverageCents < 0
                      ? `${fmt(s.coverageCents)} short`
                      : s.coverageCents === 0
                        ? 'covered'
                        : `${fmt(s.coverageCents)} spare`}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="notice">
          "Payments due" is what the instalments falling in that half add up to across the whole
          roster. A half that is short is one you will be paying for out of the other half's money —
          move an instalment date, or a cost, until both cover themselves.
        </p>
        {unassigned && unassigned.expensesCents > 0 && (
          <p className="notice">
            <strong>{fmt(unassigned.expensesCents)} is not in either half.</strong> Those costs have
            no date, so they are excluded from both subtotals rather than guessed at — give them an
            incurred date, or set their half directly, and they will be counted.
          </p>
        )}
      </div>
    </>
  );
}

function PaidCell({
  line,
  onChanged,
  onError,
}: {
  line: BudgetLine;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(line.paidOn ?? new Date().toISOString().slice(0, 10));

  const save = (on: string) =>
    api
      .post(`/expenses/${line.id}/pay`, { paidOn: on })
      .then(() => {
        setEditing(false);
        onChanged();
      })
      .catch((err: Error) => onError(err.message));

  if (editing) {
    return (
      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="link" onClick={() => save(date)}>Save</button>
        <button className="link" onClick={() => setEditing(false)}>Cancel</button>
      </span>
    );
  }

  if (line.paidOn) {
    return (
      <span style={{ whiteSpace: 'nowrap' }}>
        <span className="settled">{line.paidOn}</span>{' '}
        <button className="link" onClick={() => setEditing(true)} title="Change the date">
          edit
        </button>
        <button
          className="link danger"
          onClick={() =>
            api
              .post(`/expenses/${line.id}/unpay`)
              .then(onChanged)
              .catch((err: Error) => onError(err.message))
          }
          title="Unmark as paid and remove the bank line"
        >
          undo
        </button>
      </span>
    );
  }

  return (
    <button className="link" onClick={() => setEditing(true)}>Mark paid</button>
  );
}

function AddLine({
  kind,
  seasonId,
  options,
  field,
  split,
  onAdded,
}: {
  kind: 'expenses' | 'credits';
  seasonId: number;
  options: readonly (readonly [string, string])[];
  field: 'category' | 'kind';
  split?: boolean;
  onAdded: () => void;
}) {
  const [group, setGroup] = useState(options[0][0]);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [half, setHalf] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseMoney(amount);
    if (cents === null) return setError('Enter an amount like 275 or 1,234.50');
    setError(null);
    api
      .post(`/seasons/${seasonId}/${kind}`, {
        [field]: group,
        label,
        amountCents: cents,
        ...(kind === 'expenses' && half ? { segment: half } : {}),
      })
      .then(() => {
        setLabel('');
        setAmount('');
        setHalf('');
        onAdded();
      })
      .catch((err: Error) => setError(err.message));
  };

  return (
    <form className="form-row" onSubmit={submit} style={{ marginTop: 12 }}>
      <div className="field">
        <label>{field === 'category' ? 'Category' : 'Kind'}</label>
        <select value={group} onChange={(e) => setGroup(e.target.value)}>
          {options.map(([value, text]) => (
            <option key={value} value={value}>{text}</option>
          ))}
        </select>
      </div>
      <div className="field" style={{ flex: 1, minWidth: 180 }}>
        <label>Description</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={kind === 'expenses' ? 'Goalie training' : 'Car wash'}
          required
        />
      </div>
      <div className="field">
        <label>Amount</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="90.00" required />
      </div>
      {split && kind === 'expenses' && (
        <div className="field">
          <label>Half</label>
          <select value={half} onChange={(e) => setHalf(e.target.value)}>
            <option value="">by date</option>
            <option value="fall">Fall</option>
            <option value="spring">Spring</option>
          </select>
        </div>
      )}
      <button type="submit">Add</button>
      {error && <span className="owes" style={{ fontSize: 13 }}>{error}</span>}
    </form>
  );
}
