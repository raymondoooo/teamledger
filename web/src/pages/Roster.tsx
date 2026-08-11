import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SeasonContext } from '../App.js';
import { api, fmt, type PlayerBalance, type SeasonBudget } from '../api.js';
import { AddSection } from '../ui.js';

type SortKey =
  | 'jerseyNumber'
  | 'name'
  | 'shareCents'
  | 'carriedBalanceCents'
  | 'raisedCents'
  | 'duesCents'
  | 'paidCents'
  | 'balanceCents';

// hideSm drops the column on a phone. What survives is what the treasurer
// actually checks on the sideline: who this is, what they owe, and the ticks.
const COLUMNS: { key: SortKey; label: string; num: boolean; hideSm?: boolean }[] = [
  { key: 'jerseyNumber', label: '#', num: false, hideSm: true },
  { key: 'name', label: 'Player', num: false },
  { key: 'shareCents', label: 'Share', num: true, hideSm: true },
  { key: 'carriedBalanceCents', label: 'Carried in', num: true, hideSm: true },
  { key: 'raisedCents', label: 'Raised', num: true, hideSm: true },
  { key: 'duesCents', label: 'Dues', num: true },
  { key: 'paidCents', label: 'Paid', num: true, hideSm: true },
  { key: 'balanceCents', label: 'Balance', num: true },
];

export default function Roster({ ctx }: { ctx: SeasonContext }) {
  const [budget, setBudget] = useState<SeasonBudget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [busyRow, setBusyRow] = useState<number | null>(null);

  const load = useCallback(() => {
    api
      .get<SeasonBudget>(`/seasons/${ctx.season.id}/budget`)
      .then(setBudget)
      .catch((err: Error) => setError(err.message));
  }, [ctx.season.id]);

  useEffect(load, [load]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  const rows = useMemo(() => {
    if (!budget) return [];
    const copy = [...budget.playerBalances];
    copy.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      // Jersey numbers are text but sort as numbers when they look like them,
      // so 7 comes before 44 rather than after it.
      if (sort.key === 'jerseyNumber') {
        const an = Number(av ?? Number.POSITIVE_INFINITY);
        const bn = Number(bv ?? Number.POSITIVE_INFINITY);
        if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * sort.dir;
      }
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sort.dir;
      return String(av ?? '').localeCompare(String(bv ?? '')) * sort.dir;
    });
    return copy;
  }, [budget, sort]);

  const setInstallment = (playerId: number, which: 'first' | 'final', paid: boolean) => {
    setBusyRow(playerId);
    api
      .post(`/seasons/${ctx.season.id}/installment`, { playerId, which, paid })
      .then(load)
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusyRow(null));
  };

  const removeFromRoster = (seasonPlayerId: number, name: string) => {
    if (!confirm(`Remove ${name} from this season's roster? Their payments stay in the ledger.`)) {
      return;
    }
    api
      .del(`/season-players/${seasonPlayerId}`)
      .then(load)
      .catch((err: Error) => setError(err.message));
  };

  if (error) return <div className="error">{error}</div>;
  if (!budget) return <p className="muted">Loading…</p>;

  const hasPlan = ctx.season.firstPaymentCents !== null;

  return (
    <>
      <AddSection
        title="Roster"
        addLabel="+ Add player"
        form={(close) => (
          <AddPlayer
            seasonId={ctx.season.id}
            onDone={() => {
              close();
              load();
            }}
          />
        )}
      >
        <table>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={[c.num ? 'num' : '', 'sortable', c.hideSm ? 'hide-sm' : '']
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => toggleSort(c.key)}
                  title="Sort by this column"
                >
                  {c.label}
                  <span className="sort-arrow">
                    {sort.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : ''}
                  </span>
                </th>
              ))}
              {hasPlan && <th title="Tick when the first payment arrives">1st</th>}
              {hasPlan && <th title="Tick when the final payment arrives">2nd</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={hasPlan ? 11 : 9} className="muted">No players yet.</td>
              </tr>
            )}
            {rows.map((p) => (
              <tr key={p.playerId}>
                <td className="muted hide-sm">{p.jerseyNumber ?? '—'}</td>
                <td>
                  <Link to={`/roster/${p.playerId}`}>{p.name}</Link>
                  {p.hasOverride && <span className="badge grey" style={{ marginLeft: 6 }}>Fixed</span>}
                </td>
                <td className="num hide-sm">{fmt(p.shareCents)}</td>
                <td className="num muted hide-sm">
                  {p.carriedBalanceCents === 0 ? '—' : fmt(p.carriedBalanceCents)}
                </td>
                <td className="num muted hide-sm">{p.raisedCents === 0 ? '—' : fmt(p.raisedCents)}</td>
                <td className="num">{fmt(p.duesCents)}</td>
                <td className="num hide-sm">{fmt(p.paidCents)}</td>
                <td
                  className={`num ${p.balanceCents > 0 ? 'owes' : p.balanceCents < 0 ? 'overpaid' : 'settled'}`}
                >
                  {fmt(p.balanceCents)}
                </td>
                {hasPlan && (
                  <InstallmentCell
                    player={p}
                    which="first"
                    busy={busyRow === p.playerId}
                    onToggle={setInstallment}
                  />
                )}
                {hasPlan && (
                  <InstallmentCell
                    player={p}
                    which="final"
                    busy={busyRow === p.playerId}
                    onToggle={setInstallment}
                  />
                )}
                <td className="num hide-sm">
                  <button className="link danger" onClick={() => removeFromRoster(p.seasonPlayerId, p.name)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            <tr className="subtotal">
              <td className="hide-sm" />
              <td>{budget.rosterCount} players</td>
              <td className="hide-sm" colSpan={3} />
              <td className="num">{fmt(budget.netDueCents)}</td>
              <td className="num hide-sm">{fmt(budget.totalCollectedCents)}</td>
              <td className="num">{fmt(budget.netDueCents - budget.totalCollectedCents)}</td>
              {hasPlan && <td colSpan={2} />}
              <td className="hide-sm" />
            </tr>
          </tbody>
        </table>
        {hasPlan && (
          <p className="notice">
            Ticking an instalment records a payment for that exact amount, dated today. Unticking
            removes it again. For a part payment or a different date, open the player.
          </p>
        )}
      </AddSection>
    </>
  );
}

function InstallmentCell({
  player,
  which,
  busy,
  onToggle,
}: {
  player: PlayerBalance;
  which: 'first' | 'final';
  busy: boolean;
  onToggle: (playerId: number, which: 'first' | 'final', paid: boolean) => void;
}) {
  const checked = which === 'first' ? player.firstPaid : player.finalPaid;
  const amount = which === 'first' ? player.firstPaymentDueCents : player.finalPaymentDueCents;
  return (
    <td title={`${fmt(amount)}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={busy}
        onChange={(e) => onToggle(player.playerId, which, e.target.checked)}
      />
    </td>
  );
}

function AddPlayer({ seasonId, onDone }: { seasonId: number; onDone: () => void }) {
  const [form, setForm] = useState({
    name: '',
    jerseyNumber: '',
    size: '',
    parentName: '',
    parentEmail: '',
    parentPhone: '',
    venmoHandle: '',
  });
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    api
      .post(`/seasons/${seasonId}/roster`, {
        name: form.name,
        jerseyNumber: form.jerseyNumber || null,
        size: form.size || null,
        parentName: form.parentName || null,
        parentEmail: form.parentEmail || null,
        parentPhone: form.parentPhone || null,
        venmoHandle: form.venmoHandle || null,
      })
      .then(onDone)
      .catch((err: Error) => setError(err.message));
  };

  return (
    <form onSubmit={submit} style={{ marginBottom: 16 }}>
      {error && <div className="error">{error}</div>}
      <div className="form-row">
        <div className="field" style={{ flex: 2, minWidth: 160 }}>
          <label>Player name</label>
          <input value={form.name} onChange={set('name')} required autoFocus />
        </div>
        <div className="field" style={{ width: 80 }}>
          <label>Jersey #</label>
          <input value={form.jerseyNumber} onChange={set('jerseyNumber')} />
        </div>
        <div className="field" style={{ width: 80 }}>
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
        <button className="primary" type="submit">Add to roster</button>
      </div>
    </form>
  );
}
