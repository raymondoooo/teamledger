import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SeasonContext } from '../App.js';
import {
  api,
  fmt,
  thisSundayYmd,
  todayYmd,
  type RefLedgerRow,
  type SeasonBudget,
  type TrainerLedgerRow,
} from '../api.js';
import { PayableRow, PayDayCard, SectionHead } from '../ui.js';

export default function Dashboard({ ctx }: { ctx: SeasonContext }) {
  const [budget, setBudget] = useState<SeasonBudget | null>(null);
  const [trainerRows, setTrainerRows] = useState<TrainerLedgerRow[]>([]);
  const [refRows, setRefRows] = useState<RefLedgerRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The day the next envelope has to cover — trainer and refs alike. Sunday by
  // default, because it gets filled on a Friday and the weekend's games count.
  const [payDay, setPayDay] = useState(thisSundayYmd());

  const load = useCallback(() => {
    Promise.all([
      api.get<SeasonBudget>(`/seasons/${ctx.season.id}/budget`),
      api.get<TrainerLedgerRow[]>(`/seasons/${ctx.season.id}/trainer-ledger?payDay=${payDay}`),
      api.get<RefLedgerRow[]>(`/seasons/${ctx.season.id}/ref-ledger?payDay=${payDay}`),
    ])
      .then(([b, t, r]) => {
        setBudget(b);
        setTrainerRows(t);
        setRefRows(r);
      })
      .catch((err: Error) => setError(err.message));
  }, [ctx.season.id, payDay]);

  useEffect(load, [load]);

  if (error) return <div className="error">{error}</div>;
  if (!budget) return <p className="muted">Loading…</p>;

  // Per-session trainers and ref fees get a pay-day card — whether or not
  // anything is owed today, since paying ahead for the weekend is the normal
  // case. One with no sessions and no payments (an assistant never booked) is
  // left out.
  const inPlay = (r: { payDay: unknown; scheduledSessions: number; paidCents: number }) =>
    !!r.payDay && (r.scheduledSessions > 0 || r.paidCents > 0);
  const payCards = [
    ...trainerRows.filter(inPlay).map((t) => (
      <PayDayCard
        key={`trainer-${t.trainerId}`}
        name={t.name}
        paidThrough={t.paidThrough}
        quote={t.payDay}
        payments={t.payments}
        payUrl={`/seasons/${ctx.season.id}/trainer-payments`}
        deletePrefix="/trainer-payments"
        extraFields={{ trainerId: t.trainerId }}
        onChanged={load}
      />
    )),
    ...refRows.filter(inPlay).map((r) => (
      <PayDayCard
        key={`ref-${r.ruleId}`}
        name={r.label}
        paidThrough={r.paidThrough}
        quote={r.payDay}
        payments={r.payments}
        payUrl={`/seasons/${ctx.season.id}/ref-payments`}
        deletePrefix="/ref-payments"
        extraFields={{ ruleId: r.ruleId }}
        onChanged={load}
      />
    )),
  ];

  // Everyone else with money moving either way — still owed, or paid ahead. A
  // row sitting at exactly zero has nothing to do here and just adds noise.
  const duePayees = [
    ...trainerRows
      .filter((t) => !t.payDay && t.owedCents !== 0)
      .map((t) => ({ kind: 'trainer' as const, row: t })),
    ...refRows
      .filter((r) => !r.payDay && r.owedCents !== 0)
      .map((r) => ({ kind: 'ref' as const, row: r })),
  ].sort((a, b) => b.row.owedCents - a.row.owedCents);

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

      {payCards.length > 0 && (
        <>
          <SectionHead title="Trainer & ref pay">
            <div className="pay-day-picker">
              <label htmlFor="pay-day">Pay through</label>
              <input
                id="pay-day"
                type="date"
                value={payDay}
                onChange={(e) => e.target.value && setPayDay(e.target.value)}
              />
              <button className="link" onClick={() => setPayDay(thisSundayYmd())}>This Sunday</button>
              <button className="link" onClick={() => setPayDay(todayYmd())}>Today</button>
            </div>
          </SectionHead>
          {payCards}
        </>
      )}

      {/* Flat fees, which are not paid session by session. With cards on screen
          an empty table here would only contradict them, so it goes. */}
      {(payCards.length === 0 || duePayees.length > 0) && (
        <>
        <h2>{payCards.length > 0 ? 'Flat fees' : 'Trainers & refs'} ({duePayees.length})</h2>
        <div className="panel table-wrap">
          {duePayees.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Nobody is owed anything right now.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Who</th>
                  <th className="num">Owed now</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {duePayees.map(({ kind, row }) =>
                  kind === 'trainer' ? (
                    <PayableRow
                      key={`trainer-${row.trainerId}`}
                      label={row.name}
                      completedSessions={row.completedSessions}
                      billedSessions={row.billedSessions}
                      earnedToDateCents={row.earnedToDateCents}
                      paidCents={row.paidCents}
                      owedCents={row.owedCents}
                      forecastCents={row.forecastCents}
                      payments={row.payments}
                      payUrl={`/seasons/${ctx.season.id}/trainer-payments`}
                      deletePrefix="/trainer-payments"
                      extraFields={{ trainerId: row.trainerId }}
                      onChanged={load}
                      compact
                    />
                  ) : (
                    <PayableRow
                      key={`ref-${row.ruleId}`}
                      label={row.label}
                      completedSessions={row.completedSessions}
                      billedSessions={row.billedSessions}
                      earnedToDateCents={row.earnedToDateCents}
                      paidCents={row.paidCents}
                      owedCents={row.owedCents}
                      forecastCents={row.forecastCents}
                      payments={row.payments}
                      payUrl={`/seasons/${ctx.season.id}/ref-payments`}
                      deletePrefix="/ref-payments"
                      extraFields={{ ruleId: row.ruleId }}
                      onChanged={load}
                      compact
                    />
                  ),
                )}
              </tbody>
            </table>
          )}
        </div>
        </>
      )}

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
