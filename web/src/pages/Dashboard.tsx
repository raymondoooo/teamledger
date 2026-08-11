import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SeasonContext } from '../App.js';
import { api, fmt, type SeasonBudget } from '../api.js';

export default function Dashboard({ ctx }: { ctx: SeasonContext }) {
  const [budget, setBudget] = useState<SeasonBudget | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<SeasonBudget>(`/seasons/${ctx.season.id}/budget`)
      .then(setBudget)
      .catch((err: Error) => setError(err.message));
  }, [ctx.season.id]);

  if (error) return <div className="error">{error}</div>;
  if (!budget) return <p className="muted">Loading…</p>;

  const owing = budget.playerBalances.filter((p) => p.balanceCents > 0);
  const overpaid = budget.playerBalances.filter((p) => p.balanceCents < 0);

  return (
    <>
      <div className="stat-row">
        <div className="stat">
          <div className="label">Total expenses</div>
          <div className="value">{fmt(budget.totalExpensesCents)}</div>
        </div>
        <div className="stat">
          <div className="label">Credits</div>
          <div className="value">{fmt(budget.totalCreditsCents)}</div>
        </div>
        <div className="stat">
          <div className="label">Due per player</div>
          <div className="value">{fmt(budget.quotedPerPlayerCents)}</div>
        </div>
        <div className="stat">
          <div className="label">Collected</div>
          <div className="value">{fmt(budget.totalCollectedCents)}</div>
        </div>
        <div className="stat">
          <div className="label">Outstanding</div>
          <div className="value" style={{ color: budget.totalOutstandingCents > 0 ? 'var(--danger)' : 'var(--accent)' }}>
            {fmt(budget.totalOutstandingCents)}
          </div>
        </div>
      </div>

      {budget.rosterCount === 0 && (
        <div className="panel">
          <p style={{ margin: 0 }}>
            No players on the roster yet, so there is nothing to divide costs across.{' '}
            <Link to="/roster">Add the roster</Link> to see per-player dues.
          </p>
        </div>
      )}

      <h2>Still owing ({owing.length})</h2>
      <div className="panel table-wrap">
        {owing.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Everyone is paid up.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th className="num hide-sm">Dues</th>
                <th className="num hide-sm">Paid</th>
                <th className="num">Balance</th>
                <th className="hide-sm">Venmo</th>
              </tr>
            </thead>
            <tbody>
              {owing.map((p) => (
                <tr key={p.playerId}>
                  <td><Link to={`/roster/${p.playerId}`}>{p.name}</Link></td>
                  <td className="num hide-sm">{fmt(p.duesCents)}</td>
                  <td className="num hide-sm">{fmt(p.paidCents)}</td>
                  <td className="num owes">{fmt(p.balanceCents)}</td>
                  <td className="muted hide-sm">{p.venmoHandle ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {overpaid.length > 0 && (
        <>
          <h2>Overpaid ({overpaid.length})</h2>
          <div className="panel table-wrap">
            <p className="notice" style={{ marginTop: 0 }}>
              These players are owed money back. Rolling into a new season carries the
              credit forward instead of refunding it.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="num">Overpaid by</th>
                </tr>
              </thead>
              <tbody>
                {overpaid.map((p) => (
                  <tr key={p.playerId}>
                    <td><Link to={`/roster/${p.playerId}`}>{p.name}</Link></td>
                    <td className="num overpaid">{fmt(-p.balanceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
