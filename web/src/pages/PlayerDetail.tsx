import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { SeasonContext } from '../App.js';
import {
  api,
  fmt,
  parseMoney,
  type PlayerBalance,
  type RosterRow,
  type SeasonBudget,
} from '../api.js';
import { AddSection, Collapsible, EditableCard } from '../ui.js';

const METHODS = ['venmo', 'cash', 'zelle', 'check', 'other'] as const;

export default function PlayerDetail({ ctx }: { ctx: SeasonContext }) {
  const { playerId } = useParams();
  const id = Number(playerId);
  const [budget, setBudget] = useState<SeasonBudget | null>(null);
  // The budget only carries the fields the money screens need. Contact details
  // and jersey/size live on the roster row, so the edit form reads from there.
  const [rosterRow, setRosterRow] = useState<RosterRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api.get<SeasonBudget>(`/seasons/${ctx.season.id}/budget`),
      api.get<RosterRow[]>(`/seasons/${ctx.season.id}/roster`),
    ])
      .then(([b, roster]) => {
        setBudget(b);
        setRosterRow(roster.find((r) => r.playerId === Number(playerId)) ?? null);
      })
      .catch((err: Error) => setError(err.message));
  }, [ctx.season.id, playerId]);

  useEffect(load, [load]);

  if (error) return <div className="error">{error}</div>;
  if (!budget) return <p className="muted">Loading…</p>;

  const player = budget.playerBalances.find((p) => p.playerId === id);
  if (!player) {
    return (
      <div className="panel">
        <p>That player is not on this season's roster. <Link to="/roster">Back to roster</Link></p>
      </div>
    );
  }

  const deletePayment = (paymentId: number) => {
    if (!confirm('Delete this payment from the ledger?')) return;
    api.del(`/payments/${paymentId}`).then(load).catch((err: Error) => setError(err.message));
  };

  return (
    <>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>{player.name}</h2>
        <Link to="/roster" className="muted">← Roster</Link>
        <a
          className="btn"
          href={`/api/seasons/${ctx.season.id}/export/statement/${player.playerId}.pdf`}
          style={{ marginLeft: 'auto', textDecoration: 'none' }}
        >
          Statement PDF
        </a>
      </div>

      <div className="stat-row">
        <div className="stat">
          <div className="label">Dues</div>
          <div className="value">{fmt(player.duesCents)}</div>
        </div>
        <div className="stat">
          <div className="label">Paid</div>
          <div className="value">{fmt(player.paidCents)}</div>
        </div>
        <div className="stat">
          <div className="label">Balance</div>
          <div
            className="value"
            style={{ color: player.balanceCents > 0 ? 'var(--danger)' : 'var(--accent)' }}
          >
            {fmt(player.balanceCents)}
          </div>
        </div>
      </div>

      <div className="panel">
        <table>
          <tbody>
            <tr>
              <td>Share of team costs</td>
              <td className="num">{fmt(player.shareCents)}</td>
            </tr>
            {player.carriedBalanceCents !== 0 && (
              <tr>
                <td>
                  {player.carriedBalanceCents > 0
                    ? 'Credit carried from last season'
                    : 'Balance carried from last season'}
                </td>
                <td className="num">{fmt(-player.carriedBalanceCents)}</td>
              </tr>
            )}
            {player.raisedCents !== 0 && (
              <tr>
                <td>Fundraising raised</td>
                <td className="num">{fmt(-player.raisedCents)}</td>
              </tr>
            )}
            <tr className="subtotal">
              <td>Total dues</td>
              <td className="num">{fmt(player.duesCents)}</td>
            </tr>
            {player.installments.length > 1 &&
              player.installments.map((i) => (
                <tr key={i.id}>
                  <td className="muted">
                    {i.label?.trim() || `Payment ${i.seq}`}
                    {i.dueDate ? ` — due ${i.dueDate}` : ''}
                    {i.paid ? ' (paid)' : ''}
                  </td>
                  <td className="num muted">{fmt(i.amountCents)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <AddSection
        title="Payment ledger"
        addLabel="+ Record payment"
        form={(close) => (
          <RecordPayment
            seasonId={ctx.season.id}
            player={player}
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
              <th>Date</th>
              <th className="num">Amount</th>
              <th>Method</th>
              <th>Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {player.payments.length === 0 && (
              <tr><td colSpan={5} className="muted">No payments recorded.</td></tr>
            )}
            {player.payments.map((p) => (
              <tr key={p.id}>
                <td>{p.paidAt}</td>
                <td className="num">{fmt(p.amountCents)}</td>
                <td>{p.method}</td>
                <td className="muted">{p.note ?? ''}</td>
                <td className="num">
                  <button className="link danger" onClick={() => deletePayment(p.id)}>Delete</button>
                </td>
              </tr>
            ))}
            <tr className="subtotal">
              <td>Total paid</td>
              <td className="num">{fmt(player.paidCents)}</td>
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>
      </AddSection>

      {rosterRow && (
        <EditableCard
          summary={<PlayerSummary row={rosterRow} />}
          form={(close) => (
            <EditPlayer
              row={rosterRow}
              onSaved={() => {
                close();
                load();
              }}
              onError={setError}
            />
          )}
        />
      )}

      <AddSection
        title="Fundraising"
        addLabel="+ Add fundraising"
        form={(close) => (
          <AddFundraising
            seasonId={ctx.season.id}
            player={player}
            onAdded={() => {
              close();
              load();
            }}
          />
        )}
      >
        <p className="notice" style={{ marginTop: 0 }}>
          Money this player raised themselves. It comes straight off their bill — mostly off the
          second payment — rather than being shared across the team. For a car wash or anything
          the whole team raised together, use the Budget page instead.
        </p>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>What</th>
              <th className="num">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {player.credits.length === 0 && (
              <tr><td colSpan={4} className="muted">Nothing raised yet.</td></tr>
            )}
            {player.credits.map((c) => (
              <tr key={c.id}>
                <td className="muted">{c.receivedOn ?? '—'}</td>
                <td>{c.label}</td>
                <td className="num">{fmt(c.amountCents)}</td>
                <td className="num">
                  <button
                    className="link danger"
                    onClick={() =>
                      api
                        .del(`/player-credits/${c.id}`)
                        .then(load)
                        .catch((err: Error) => setError(err.message))
                    }
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            <tr className="subtotal">
              <td colSpan={2}>Total raised</td>
              <td className="num">{fmt(player.raisedCents)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </AddSection>

      <Collapsible
        title="Dues override"
        hint={
          player.hasOverride ? (
            <span className="badge grey">Fixed at {fmt(player.shareCents)}</span>
          ) : (
            <span className="muted">— even split</span>
          )
        }
      >
        <div className="panel">
          <DuesOverride player={player} onSaved={load} />
        </div>
      </Collapsible>
    </>
  );
}

function RecordPayment({
  seasonId,
  player,
  onAdded,
}: {
  seasonId: number;
  player: PlayerBalance;
  onAdded: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [paidAt, setPaidAt] = useState(today);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<(typeof METHODS)[number]>('venmo');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseMoney(amount);
    if (cents === null) return setError('Enter an amount like 150 or 121.67');
    setError(null);
    api
      .post(`/seasons/${seasonId}/payments`, {
        playerId: player.playerId,
        paidAt,
        amountCents: cents,
        method,
        note: note || null,
      })
      .then(() => {
        setAmount('');
        setNote('');
        onAdded();
      })
      .catch((err: Error) => setError(err.message));
  };

  const remaining = player.balanceCents;

  return (
    <form className="form-row" onSubmit={submit} style={{ marginTop: 12 }}>
      <div className="field">
        <label>Date</label>
        <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required />
      </div>
      <div className="field" style={{ width: 110 }}>
        <label>Amount</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="150.00" required />
      </div>
      <div className="field">
        <label>Method</label>
        <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
          {METHODS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
      <div className="field" style={{ flex: 1, minWidth: 140 }}>
        <label>Note</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="1st payment" />
      </div>
      <button className="primary" type="submit">Record</button>
      {remaining > 0 && (
        <button type="button" onClick={() => setAmount((remaining / 100).toFixed(2))}>
          Pay off {fmt(remaining)}
        </button>
      )}
      {error && <span className="owes" style={{ fontSize: 13 }}>{error}</span>}
    </form>
  );
}

// What you see when you are not editing: the same facts, as text.
function PlayerSummary({ row }: { row: RosterRow }) {
  const bits = [
    row.jerseyNumber ? `#${row.jerseyNumber}` : null,
    row.size,
    row.parentName,
    row.parentEmail,
    row.parentPhone,
    row.venmoHandle,
  ].filter(Boolean);
  return (
    <div>
      <strong>{row.name}</strong>
      <div className="muted" style={{ fontSize: 13 }}>
        {bits.length ? bits.join(' · ') : 'No contact details yet'}
      </div>
    </div>
  );
}

// Name and contact details belong to the player and follow them across seasons;
// jersey number and size belong to this season's roster row. Two records, one
// form — saving writes to whichever of them actually changed.
function EditPlayer({
  row,
  onSaved,
  onError,
}: {
  row: RosterRow;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const initial = {
    name: row.name,
    parentName: row.parentName ?? '',
    parentEmail: row.parentEmail ?? '',
    parentPhone: row.parentPhone ?? '',
    venmoHandle: row.venmoHandle ?? '',
    jerseyNumber: row.jerseyNumber ?? '',
    size: row.size ?? '',
  };
  const [form, setForm] = useState(initial);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-seed when the loaded row changes, or a save would leave the inputs
  // showing what was typed rather than what was stored.
  useEffect(() => setForm(initial), [row.playerId, row.seasonPlayerId, row.name]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  const dirty = (Object.keys(initial) as (keyof typeof form)[]).some(
    (k) => form[k] !== initial[k],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const playerChanged =
        form.name !== initial.name ||
        form.parentName !== initial.parentName ||
        form.parentEmail !== initial.parentEmail ||
        form.parentPhone !== initial.parentPhone ||
        form.venmoHandle !== initial.venmoHandle;
      if (playerChanged) {
        await api.patch(`/players/${row.playerId}`, {
          name: form.name,
          parentName: form.parentName || null,
          parentEmail: form.parentEmail || null,
          parentPhone: form.parentPhone || null,
          venmoHandle: form.venmoHandle || null,
        });
      }
      if (form.jerseyNumber !== initial.jerseyNumber || form.size !== initial.size) {
        await api.patch(`/season-players/${row.seasonPlayerId}`, {
          jerseyNumber: form.jerseyNumber || null,
          size: form.size || null,
        });
      }
      setStatus('Saved.');
      onSaved();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="form-row">
        <div className="field" style={{ flex: 2, minWidth: 160 }}>
          <label>Player name</label>
          <input value={form.name} onChange={set('name')} required />
        </div>
        <div className="field" style={{ width: 90 }}>
          <label>Jersey #</label>
          <input value={form.jerseyNumber} onChange={set('jerseyNumber')} />
        </div>
        <div className="field" style={{ width: 90 }}>
          <label>Size</label>
          <input value={form.size} onChange={set('size')} />
        </div>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <div className="field" style={{ flex: 1, minWidth: 140 }}>
          <label>Parent name</label>
          <input value={form.parentName} onChange={set('parentName')} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 180 }}>
          <label>Parent email</label>
          <input type="email" value={form.parentEmail} onChange={set('parentEmail')} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 130 }}>
          <label>Phone</label>
          <input value={form.parentPhone} onChange={set('parentPhone')} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 120 }}>
          <label>Venmo</label>
          <input value={form.venmoHandle} onChange={set('venmoHandle')} placeholder="@handle" />
        </div>
      </div>
      <div className="form-row" style={{ marginTop: 12 }}>
        <button className="primary" type="submit" disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        {status && <span className="notice">{status}</span>}
      </div>
      <p className="notice">
        Name and contact details follow this player into future seasons. Jersey number and size
        are just for this one.
      </p>
    </form>
  );
}

function AddFundraising({
  seasonId,
  player,
  onAdded,
}: {
  seasonId: number;
  player: PlayerBalance;
  onAdded: () => void;
}) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseMoney(amount);
    if (cents === null) return setError('Enter an amount like 80 or 20.50');
    setError(null);
    api
      .post(`/seasons/${seasonId}/player-credits`, {
        playerId: player.playerId,
        kind: 'fundraiser',
        label,
        amountCents: cents,
        receivedOn,
      })
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
        <label>Date</label>
        <input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
      </div>
      <div className="field" style={{ flex: 1, minWidth: 150 }}>
        <label>What they sold</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Raffle books"
          required
        />
      </div>
      <div className="field" style={{ width: 110 }}>
        <label>Amount</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="80.00" required />
      </div>
      <button type="submit">Add</button>
      {error && <span className="owes" style={{ fontSize: 13 }}>{error}</span>}
    </form>
  );
}

function DuesOverride({ player, onSaved }: { player: PlayerBalance; onSaved: () => void }) {
  const [value, setValue] = useState(player.hasOverride ? (player.shareCents / 100).toFixed(2) : '');
  const [error, setError] = useState<string | null>(null);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = value.trim() === '' ? null : parseMoney(value);
    if (value.trim() !== '' && cents === null) return setError('Enter an amount or leave blank');
    setError(null);
    api
      .patch(`/season-players/${player.seasonPlayerId}`, { duesOverrideCents: cents })
      .then(onSaved)
      .catch((err: Error) => setError(err.message));
  };

  return (
    <form onSubmit={save}>
      <p className="notice" style={{ marginTop: 0 }}>
        Leave blank for an even split. Set an amount for a scholarship, sibling discount, or a
        late joiner — the rest of the roster absorbs the difference.
      </p>
      <div className="form-row">
        <div className="field" style={{ width: 130 }}>
          <label>Fixed dues</label>
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="even split" />
        </div>
        <button type="submit">Save</button>
        {error && <span className="owes" style={{ fontSize: 13 }}>{error}</span>}
      </div>
    </form>
  );
}
