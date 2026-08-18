import { useCallback, useEffect, useState } from 'react';
import type { SeasonContext } from '../App.js';
import { api, fmt, parseMoney, type BudgetLine, type SeasonBudget } from '../api.js';
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
        {ctx.season.firstPaymentCents !== null && (
          <p className="notice">
            Payment plan: {fmt(ctx.season.firstPaymentCents)} first payment, remainder due
            after. Set this on the Settings page.
          </p>
        )}
      </div>
    </>
  );
}

// Marking an expense paid writes the bank withdrawal. The date is editable
// because the day a cost is incurred is rarely the day the money leaves.
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
  onAdded,
}: {
  kind: 'expenses' | 'credits';
  seasonId: number;
  options: readonly (readonly [string, string])[];
  field: 'category' | 'kind';
  onAdded: () => void;
}) {
  const [group, setGroup] = useState(options[0][0]);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseMoney(amount);
    if (cents === null) return setError('Enter an amount like 275 or 1,234.50');
    setError(null);
    api
      .post(`/seasons/${seasonId}/${kind}`, { [field]: group, label, amountCents: cents })
      .then(() => {
        setLabel('');
        setAmount('');
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
      <button type="submit">Add</button>
      {error && <span className="owes" style={{ fontSize: 13 }}>{error}</span>}
    </form>
  );
}
