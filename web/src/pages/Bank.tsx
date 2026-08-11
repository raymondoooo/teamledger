import { useCallback, useEffect, useState } from 'react';
import type { SeasonContext } from '../App.js';
import {
  api,
  fmt,
  parseMoney,
  type BankLedger,
  type TrainerLedgerRow,
  type UntransferredPayment,
} from '../api.js';
import { AddSection, Collapsible } from '../ui.js';

// The ledger book, replacing the paper one. Three questions it answers:
// what is in the account, what is still sitting in the treasurer's own Venmo,
// and what the team still owes its trainers.
export default function Bank({ ctx }: { ctx: SeasonContext }) {
  const [ledger, setLedger] = useState<BankLedger | null>(null);
  const [held, setHeld] = useState<UntransferredPayment[]>([]);
  const [trainerRows, setTrainerRows] = useState<TrainerLedgerRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api.get<BankLedger>(`/teams/${ctx.team.id}/bank`),
      api.get<UntransferredPayment[]>(`/teams/${ctx.team.id}/untransferred`),
      api.get<TrainerLedgerRow[]>(`/seasons/${ctx.season.id}/trainer-ledger`),
    ])
      .then(([l, u, t]) => {
        setLedger(l);
        setHeld(u);
        setTrainerRows(t);
      })
      .catch((err: Error) => setError(err.message));
  }, [ctx.team.id, ctx.season.id]);

  useEffect(load, [load]);

  if (error) return <div className="error">{error}</div>;
  if (!ledger) return <p className="muted">Loading…</p>;

  // Only work already done counts as owed — a practice three weeks out is not a
  // debt, and showing it as one would make the account look emptier than it is.
  const owedToTrainers = trainerRows.reduce((s, t) => s + Math.max(0, t.owedCents), 0);

  return (
    <>
      <div className="stat-row">
        <div className="stat">
          <div className="label">Team account</div>
          <div className="value">{fmt(ledger.balanceCents)}</div>
        </div>
        <div className="stat">
          <div className="label">Held in your Venmo</div>
          <div
            className="value"
            style={{ color: ledger.untransferredCents > 0 ? 'var(--warn)' : undefined }}
          >
            {fmt(ledger.untransferredCents)}
          </div>
        </div>
        <div className="stat">
          <div className="label">Owed to trainers now</div>
          <div className="value" style={{ color: owedToTrainers > 0 ? 'var(--danger)' : undefined }}>
            {fmt(owedToTrainers)}
          </div>
        </div>
        <div className="stat">
          <div className="label">After clearing both</div>
          <div className="value">
            {fmt(ledger.balanceCents + ledger.untransferredCents - owedToTrainers)}
          </div>
        </div>
      </div>

      {held.length > 0 && (
        <>
          <h2>Waiting to move to the team account ({held.length})</h2>
          <Transfers teamId={ctx.team.id} held={held} onDone={load} onError={setError} />
        </>
      )}


      {/* The form sits at the top of the panel, not buried under the
          transactions: on a ledger with any history it was several screens down
          and effectively invisible. */}
      <AddSection
        title={ledger.name}
        addLabel="+ Add line"
        form={(close) => (
          <AddTransaction
            teamId={ctx.team.id}
            seasonId={ctx.season.id}
            onAdded={() => {
              close();
              load();
            }}
            onError={setError}
          />
        )}
      >
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th className="num hide-sm">In</th>
              <th className="num hide-sm">Out</th>
              <th className="num">Balance</th>
              <th title="Tick once you have matched this against your bank statement">✓</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="muted">{ledger.startingOn ?? '—'}</td>
              <td className="muted">Starting balance</td>
              <td className="num hide-sm" />
              <td className="num hide-sm" />
              <td className="num">{fmt(ledger.startingBalanceCents)}</td>
              <td colSpan={2} />
            </tr>
            {ledger.lines.map((l) => (
              <tr key={l.id}>
                <td className="muted">{l.occurredOn}</td>
                <td>
                  {l.description}
                  {l.note && <div className="muted" style={{ fontSize: 12 }}>{l.note}</div>}
                </td>
                <td className="num settled hide-sm">{l.amountCents > 0 ? fmt(l.amountCents) : ''}</td>
                <td className="num owes hide-sm">{l.amountCents < 0 ? fmt(-l.amountCents) : ''}</td>
                <td className="num">
                  {/* On a phone the In/Out columns are gone, so the amount has
                      to be visible here or the line says nothing. */}
                  <span className="show-sm-only">
                    <span className={l.amountCents < 0 ? 'owes' : 'settled'}>
                      {l.amountCents > 0 ? '+' : ''}{fmt(l.amountCents)}
                    </span>
                    <br />
                  </span>
                  {fmt(l.balanceCents)}
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={l.reconciled}
                    onChange={(e) =>
                      api
                        .patch(`/bank/transactions/${l.id}`, { reconciled: e.target.checked })
                        .then(load)
                        .catch((err: Error) => setError(err.message))
                    }
                  />
                </td>
                <td className="num">
                  <button
                    className="link danger"
                    onClick={() => {
                      const extra =
                        l.kind === 'player_transfer'
                          ? ' The payments it covered will go back to untransferred.'
                          : l.kind === 'trainer_payment'
                            ? ' The trainer payment stays recorded — delete it from the Trainers table instead.'
                            : '';
                      if (confirm(`Delete "${l.description}"?${extra}`)) {
                        api
                          .del(`/bank/transactions/${l.id}`)
                          .then(load)
                          .catch((err: Error) => setError(err.message));
                      }
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            <tr className="subtotal">
              <td colSpan={2}>Balance</td>
              <td className="hide-sm" colSpan={2} />
              <td className="num">{fmt(ledger.balanceCents)}</td>
              <td colSpan={2} />
            </tr>
            <tr>
              <td colSpan={2} className="muted">Reconciled against your statement</td>
              <td className="hide-sm" colSpan={2} />
              <td className="num muted">{fmt(ledger.reconciledBalanceCents)}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </AddSection>

      <Collapsible
        title="Trainers"
        open={owedToTrainers > 0}
        hint={
          owedToTrainers > 0 ? (
            <span className="owes">— {fmt(owedToTrainers)} owed</span>
          ) : (
            <span className="muted">— all settled</span>
          )
        }
      >
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Trainer</th>
              <th className="num hide-sm">Done</th>
              <th className="num hide-sm">Earned so far</th>
              <th className="num hide-sm">Paid</th>
              <th className="num">Owed now</th>
              <th className="num hide-sm">Season forecast</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {trainerRows.length === 0 && (
              <tr><td colSpan={7} className="muted">No trainers on this team.</td></tr>
            )}
            {trainerRows.map((t) => (
              <TrainerRow key={t.trainerId} row={t} seasonId={ctx.season.id} onChanged={load} />
            ))}
          </tbody>
        </table>
      </div>
      </Collapsible>

      <Collapsible title="Account settings" hint={<span className="muted">— name and starting balance</span>}>
        <div className="panel">
          <StartingBalance ledger={ledger} teamId={ctx.team.id} onSaved={load} />
        </div>
      </Collapsible>
    </>
  );
}

function Transfers({
  teamId,
  held,
  onDone,
  onError,
}: {
  teamId: number;
  held: UntransferredPayment[];
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set(held.map((h) => h.id)));
  const [on, setOn] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  useEffect(() => setSelected(new Set(held.map((h) => h.id))), [held]);

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const total = held.filter((h) => selected.has(h.id)).reduce((s, h) => s + h.amountCents, 0);

  const submit = () => {
    setBusy(true);
    api
      .post(`/teams/${teamId}/transfer`, {
        paymentIds: [...selected],
        transferredOn: on,
      })
      .then(onDone)
      .catch((err: Error) => onError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="panel table-wrap">
      <p className="notice" style={{ marginTop: 0 }}>
        Parents' Venmo payments land in your personal account. Tick the ones you have moved across
        and this writes a single deposit line for the batch — the way it appears on the statement.
      </p>
      <table>
        <thead>
          <tr>
            <th style={{ width: 30 }} />
            <th>Player</th>
            <th className="hide-sm">Received</th>
            <th className="hide-sm">Method</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {held.map((h) => (
            <tr key={h.id}>
              <td>
                <input
                  type="checkbox"
                  checked={selected.has(h.id)}
                  onChange={() => toggle(h.id)}
                />
              </td>
              <td>{h.playerName}</td>
              <td className="muted hide-sm">{h.paidAt}</td>
              <td className="muted hide-sm">{h.method}</td>
              <td className="num">{fmt(h.amountCents)}</td>
            </tr>
          ))}
          <tr className="subtotal">
            <td colSpan={2}>{selected.size} selected</td>
            <td className="hide-sm" colSpan={2} />
            <td className="num">{fmt(total)}</td>
          </tr>
        </tbody>
      </table>
      <div className="form-row" style={{ marginTop: 12 }}>
        <div className="field">
          <label>Transferred on</label>
          <input type="date" value={on} onChange={(e) => setOn(e.target.value)} />
        </div>
        <button className="primary" onClick={submit} disabled={busy || selected.size === 0}>
          {busy ? 'Recording…' : `Mark ${fmt(total)} transferred`}
        </button>
      </div>
    </div>
  );
}

function TrainerRow({
  row,
  seasonId,
  onChanged,
}: {
  row: TrainerLedgerRow;
  seasonId: number;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('venmo');
  const [error, setError] = useState<string | null>(null);

  const pay = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseMoney(amount);
    if (cents === null) return setError('Enter an amount');
    setError(null);
    api
      .post(`/seasons/${seasonId}/trainer-payments`, {
        trainerId: row.trainerId,
        paidOn,
        amountCents: cents,
        method,
      })
      .then(() => {
        setAmount('');
        setOpen(false);
        onChanged();
      })
      .catch((err: Error) => setError(err.message));
  };

  return (
    <>
      <tr>
        <td>{row.name}</td>
        <td className="num muted hide-sm">
          {row.completedSessions}
          <span className="derived"> of {row.billedSessions}</span>
        </td>
        <td className="num hide-sm">{fmt(row.earnedToDateCents)}</td>
        <td className="num hide-sm">{fmt(row.paidCents)}</td>
        <td className={`num ${row.owedCents > 0 ? 'owes' : row.owedCents < 0 ? 'overpaid' : 'settled'}`}>
          {fmt(row.owedCents)}
        </td>
        <td className="num muted hide-sm">{fmt(row.forecastCents)}</td>
        <td className="num">
          <button className="link" onClick={() => setOpen((o) => !o)}>
            {open ? 'Cancel' : 'Pay'}
          </button>
        </td>
      </tr>
      {row.payments.length > 0 && (
        <tr>
          <td />
          <td colSpan={6}>
            {row.payments.map((p) => (
              <div key={p.id} className="muted" style={{ fontSize: 13 }}>
                {p.paidOn} — {fmt(p.amountCents)} ({p.method})
                <button
                  className="link danger"
                  onClick={() =>
                    confirm('Delete this trainer payment and its bank line?') &&
                    api.del(`/trainer-payments/${p.id}`).then(onChanged)
                  }
                >
                  remove
                </button>
              </div>
            ))}
          </td>
        </tr>
      )}
      {open && (
        <tr>
          <td colSpan={7}>
            <form className="form-row" onSubmit={pay}>
              <div className="field">
                <label>Date</label>
                <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </div>
              <div className="field" style={{ width: 110 }}>
                <label>Amount</label>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={(Math.max(0, row.owedCents) / 100).toFixed(2)}
                  required
                />
              </div>
              <div className="field">
                <label>Method</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)}>
                  {['venmo', 'cash', 'zelle', 'check', 'other'].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <button className="primary" type="submit">Record payment</button>
              {row.owedCents > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount((row.owedCents / 100).toFixed(2))}
                >
                  Pay all {fmt(row.owedCents)}
                </button>
              )}
              {error && <span className="owes" style={{ fontSize: 13 }}>{error}</span>}
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

function AddTransaction({
  teamId,
  seasonId,
  onAdded,
  onError,
}: {
  teamId: number;
  seasonId: number;
  onAdded: () => void;
  onError: (m: string) => void;
}) {
  const [occurredOn, setOccurredOn] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [kind, setKind] = useState('adjustment');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseMoney(amount);
    if (cents === null || cents === 0) return setError('Enter an amount');
    setError(null);
    api
      .post(`/teams/${teamId}/bank/transactions`, {
        occurredOn,
        description,
        // The form asks for a direction rather than expecting a minus sign,
        // which is where a hand-kept ledger usually goes wrong.
        amountCents: direction === 'out' ? -Math.abs(cents) : Math.abs(cents),
        kind,
        seasonId,
      })
      .then(() => {
        setDescription('');
        setAmount('');
        onAdded();
      })
      .catch((err: Error) => onError(err.message));
  };

  return (
    <form className="form-row" onSubmit={submit} style={{ marginTop: 12 }}>
      <div className="field">
        <label>Date</label>
        <input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
      </div>
      <div className="field" style={{ flex: 1, minWidth: 160 }}>
        <label>Description</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Tournament registration"
          required
        />
      </div>
      <div className="field">
        <label>Direction</label>
        <select value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out')}>
          <option value="out">Money out</option>
          <option value="in">Money in</option>
        </select>
      </div>
      <div className="field" style={{ width: 110 }}>
        <label>Amount</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="310.00" required />
      </div>
      <div className="field">
        <label>Type</label>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="expense_payment">Expense</option>
          <option value="deposit">Deposit</option>
          <option value="withdrawal">Withdrawal</option>
          <option value="fee">Bank fee</option>
          <option value="adjustment">Adjustment</option>
        </select>
      </div>
      <button type="submit">Add line</button>
      {error && <span className="owes" style={{ fontSize: 13 }}>{error}</span>}
    </form>
  );
}

function StartingBalance({
  ledger,
  teamId,
  onSaved,
}: {
  ledger: BankLedger;
  teamId: number;
  onSaved: () => void;
}) {
  const [name, setName] = useState(ledger.name);
  const [balance, setBalance] = useState((ledger.startingBalanceCents / 100).toFixed(2));
  const [on, setOn] = useState(ledger.startingOn ?? '');
  const [status, setStatus] = useState<string | null>(null);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseMoney(balance);
    if (cents === null) return setStatus('Enter a balance');
    api
      .patch(`/teams/${teamId}/bank`, {
        name,
        startingBalanceCents: cents,
        startingOn: on || null,
      })
      .then(() => {
        setStatus('Saved.');
        onSaved();
      })
      .catch((err: Error) => setStatus(err.message));
  };

  return (
    <form onSubmit={save}>
      <p className="notice" style={{ marginTop: 0 }}>
        What was in the account on the day you started keeping the books here. Every line above is
        added to this, so getting it right makes the running balance match your real statement.
      </p>
      <div className="form-row">
        <div className="field" style={{ flex: 1, minWidth: 150 }}>
          <label>Account name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field" style={{ width: 130 }}>
          <label>Starting balance</label>
          <input value={balance} onChange={(e) => setBalance(e.target.value)} />
        </div>
        <div className="field">
          <label>As of</label>
          <input type="date" value={on} onChange={(e) => setOn(e.target.value)} />
        </div>
        <button className="primary" type="submit">Save</button>
        {status && <span className="notice">{status}</span>}
      </div>
    </form>
  );
}
