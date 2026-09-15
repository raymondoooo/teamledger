import { useCallback, useEffect, useState } from 'react';
import type { SeasonContext } from '../App.js';
import {
  api,
  fmt,
  parseMoney,
  type BankLedger,
  type RefLedgerRow,
  type TrainerLedgerRow,
  type TreasurerAdvance,
  type UntransferredPayment,
} from '../api.js';
import { AddSection, Collapsible, PayableRow } from '../ui.js';

// The ledger book, replacing the paper one. Three questions it answers:
// what is in the account, what is still sitting in the treasurer's own Venmo,
// and what the team still owes its trainers.
export default function Bank({ ctx }: { ctx: SeasonContext }) {
  const [ledger, setLedger] = useState<BankLedger | null>(null);
  const [held, setHeld] = useState<UntransferredPayment[]>([]);
  const [trainerRows, setTrainerRows] = useState<TrainerLedgerRow[]>([]);
  const [refRows, setRefRows] = useState<RefLedgerRow[]>([]);
  const [advances, setAdvances] = useState<TreasurerAdvance[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api.get<BankLedger>(`/teams/${ctx.team.id}/bank`),
      api.get<UntransferredPayment[]>(`/teams/${ctx.team.id}/untransferred`),
      api.get<TrainerLedgerRow[]>(`/seasons/${ctx.season.id}/trainer-ledger`),
      api.get<RefLedgerRow[]>(`/seasons/${ctx.season.id}/ref-ledger`),
      api.get<TreasurerAdvance[]>(`/seasons/${ctx.season.id}/advances`),
    ])
      .then(([l, u, t, r, a]) => {
        setLedger(l);
        setHeld(u);
        setTrainerRows(t);
        setRefRows(r);
        setAdvances(a);
      })
      .catch((err: Error) => setError(err.message));
  }, [ctx.team.id, ctx.season.id]);

  useEffect(load, [load]);

  if (error) return <div className="error">{error}</div>;
  if (!ledger) return <p className="muted">Loading…</p>;

  // Only work already done counts as owed — a practice three weeks out is not a
  // debt, and showing it as one would make the account look emptier than it is.
  const owedToTrainers = trainerRows.reduce((s, t) => s + Math.max(0, t.owedCents), 0);
  const owedToRefs = refRows.reduce((s, r) => s + Math.max(0, r.owedCents), 0);
  const owedToYou = advances
    .filter((a) => a.reimbursedOn === null)
    .reduce((s, a) => s + a.amountCents, 0);

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
          <div className="label">Owed to trainers &amp; refs now</div>
          <div
            className="value"
            style={{ color: owedToTrainers + owedToRefs > 0 ? 'var(--danger)' : undefined }}
          >
            {fmt(owedToTrainers + owedToRefs)}
          </div>
        </div>
        <div className="stat">
          <div className="label">Owed to you</div>
          <div className="value" style={{ color: owedToYou > 0 ? 'var(--danger)' : undefined }}>
            {fmt(owedToYou)}
          </div>
        </div>
        <div className="stat">
          <div className="label">After clearing all of it</div>
          <div className="value">
            {fmt(
              ledger.balanceCents +
                ledger.untransferredCents -
                owedToTrainers -
                owedToRefs -
                owedToYou,
            )}
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
                            : l.kind === 'ref_payment'
                              ? ' The ref payment stays recorded — delete it from the Referees table instead.'
                              : l.kind === 'advance_reimbursement'
                                ? ' The advance goes back to unreimbursed instead of being deleted.'
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
              <PayableRow
                key={t.trainerId}
                label={t.name}
                completedSessions={t.completedSessions}
                billedSessions={t.billedSessions}
                earnedToDateCents={t.earnedToDateCents}
                paidCents={t.paidCents}
                owedCents={t.owedCents}
                forecastCents={t.forecastCents}
                payments={t.payments}
                payUrl={`/seasons/${ctx.season.id}/trainer-payments`}
                deletePrefix="/trainer-payments"
                extraFields={{ trainerId: t.trainerId }}
                onChanged={load}
              />
            ))}
          </tbody>
        </table>
      </div>
      </Collapsible>

      <Collapsible
        title="Referees"
        open={owedToRefs > 0}
        hint={
          owedToRefs > 0 ? (
            <span className="owes">— {fmt(owedToRefs)} owed</span>
          ) : (
            <span className="muted">— all settled</span>
          )
        }
      >
      <div className="panel table-wrap">
        <p className="notice" style={{ marginTop: 0 }}>
          There is no single "ref" to name — the league sends whoever it sends — so each ref-fee
          rule from Settings is its own payee here. Paying cash at the game? Log it as{' '}
          <a href="#money-owed-to-you">money owed to you</a> instead, so it also tracks that you
          need it back.
        </p>
        <table>
          <thead>
            <tr>
              <th>Ref-fee rule</th>
              <th className="num hide-sm">Done</th>
              <th className="num hide-sm">Earned so far</th>
              <th className="num hide-sm">Paid</th>
              <th className="num">Owed now</th>
              <th className="num hide-sm">Season forecast</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {refRows.length === 0 && (
              <tr><td colSpan={7} className="muted">No ref-fee rules on this season.</td></tr>
            )}
            {refRows.map((r) => (
              <PayableRow
                key={r.ruleId}
                label={r.label}
                completedSessions={r.completedSessions}
                billedSessions={r.billedSessions}
                earnedToDateCents={r.earnedToDateCents}
                paidCents={r.paidCents}
                owedCents={r.owedCents}
                forecastCents={r.forecastCents}
                payments={r.payments}
                payUrl={`/seasons/${ctx.season.id}/ref-payments`}
                deletePrefix="/ref-payments"
                extraFields={{ ruleId: r.ruleId }}
                onChanged={load}
              />
            ))}
          </tbody>
        </table>
      </div>
      </Collapsible>

      <div id="money-owed-to-you">
        <Collapsible
          title="Money owed to you"
          open={owedToYou > 0}
          hint={
            owedToYou > 0 ? (
              <span className="owes">— {fmt(owedToYou)} owed</span>
            ) : (
              <span className="muted">— nothing outstanding</span>
            )
          }
        >
          <Advances seasonId={ctx.season.id} advances={advances} onChanged={load} />
        </Collapsible>
      </div>

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

// Money the treasurer has fronted personally — a ref paid cash at the field, a
// jersey order on a personal card — and still needs back from the team. Adding
// one writes no bank line; the team account has not moved yet, only the
// treasurer's own money has. Reimbursing it is what actually withdraws it.
function Advances({
  seasonId,
  advances,
  onChanged,
}: {
  seasonId: number;
  advances: TreasurerAdvance[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const outstanding = advances.filter((a) => a.reimbursedOn === null);
  const settled = advances.filter((a) => a.reimbursedOn !== null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseMoney(amount);
    if (cents === null) return setError('Enter an amount');
    if (!label.trim()) return setError('Enter what this was for');
    setError(null);
    api
      .post(`/seasons/${seasonId}/advances`, { label, amountCents: cents, paidOn, note: note || null })
      .then(() => {
        setLabel('');
        setAmount('');
        setNote('');
        setAdding(false);
        onChanged();
      })
      .catch((err: Error) => setError(err.message));
  };

  const reimburse = (id: number) => {
    const on = prompt('Reimbursed on what date?', new Date().toISOString().slice(0, 10));
    if (on === null) return;
    api.post(`/advances/${id}/reimburse`, { paidOn: on }).then(onChanged).catch((err: Error) => setError(err.message));
  };

  return (
    <div className="panel table-wrap">
      <p className="notice" style={{ marginTop: 0 }}>
        Log what you spent from your own money on the team's behalf. It shows up as owed to you
        until you record the team paying you back — that withdrawal is what actually moves the
        account balance.
      </p>
      {error && <div className="error">{error}</div>}
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>What for</th>
            <th className="num">Amount</th>
            <th className="hide-sm">Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {advances.length === 0 && (
            <tr><td colSpan={5} className="muted">Nothing logged yet.</td></tr>
          )}
          {outstanding.map((a) => (
            <tr key={a.id}>
              <td className="muted">{a.paidOn}</td>
              <td>
                {a.label}
                {a.note && <div className="muted" style={{ fontSize: 12 }}>{a.note}</div>}
              </td>
              <td className="num owes">{fmt(a.amountCents)}</td>
              <td className="hide-sm muted">Owed to you</td>
              <td className="num">
                <button className="link" onClick={() => reimburse(a.id)}>Mark reimbursed</button>
                <button
                  className="link danger"
                  onClick={() => confirm('Delete this?') && api.del(`/advances/${a.id}`).then(onChanged)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {settled.map((a) => (
            <tr key={a.id}>
              <td className="muted">{a.paidOn}</td>
              <td>
                {a.label}
                {a.note && <div className="muted" style={{ fontSize: 12 }}>{a.note}</div>}
              </td>
              <td className="num settled">{fmt(a.amountCents)}</td>
              <td className="hide-sm muted">Reimbursed {a.reimbursedOn}</td>
              <td className="num">
                <button
                  className="link"
                  onClick={() => api.post(`/advances/${a.id}/unreimburse`).then(onChanged)}
                >
                  Undo
                </button>
                <button
                  className="link danger"
                  onClick={() => confirm('Delete this?') && api.del(`/advances/${a.id}`).then(onChanged)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {adding ? (
        <form className="form-row" onSubmit={submit} style={{ marginTop: 12 }}>
          <div className="field">
            <label>Date</label>
            <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label>What for</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ref fee, paid cash"
              required
            />
          </div>
          <div className="field" style={{ width: 110 }}>
            <label>Amount</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="75.00" required />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label>Note</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <button className="primary" type="submit">Log it</button>
          <button type="button" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      ) : (
        <button className="primary" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
          + I paid for something
        </button>
      )}
    </div>
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
