import { useCallback, useEffect, useState } from 'react';
import type { SeasonContext } from '../App.js';
import { api, fmt, parseMoney, type Feed, type TeamEvent, type Trainer } from '../api.js';
import { Collapsible } from '../ui.js';

const TYPES = [
  ['game', 'Game'],
  ['practice', 'Practice'],
  ['tournament', 'Tournament'],
  ['other', 'Other'],
] as const;

export default function Schedule({ ctx }: { ctx: SeasonContext }) {
  const [events, setEvents] = useState<TeamEvent[]>([]);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      api.get<TeamEvent[]>(`/seasons/${ctx.season.id}/events`),
      api.get<Trainer[]>(`/teams/${ctx.team.id}/trainers`),
      api.get<Feed[]>(`/seasons/${ctx.season.id}/feeds`),
    ])
      .then(([e, t, f]) => {
        setEvents(e);
        setTrainers(t);
        setFeeds(f);
      })
      .catch((err: Error) => setError(err.message));
  }, [ctx.season.id, ctx.team.id]);

  useEffect(load, [load]);

  const syncAll = () => {
    setSyncing(true);
    setStatus(null);
    Promise.all(feeds.map((f) => api.post<{ imported: number; updated: number; error?: string }>(`/feeds/${f.id}/sync`)))
      .then((results) => {
        const imported = results.reduce((s, r) => s + r.imported, 0);
        const updated = results.reduce((s, r) => s + r.updated, 0);
        const failed = results.filter((r) => r.error);
        setStatus(
          failed.length
            ? `Sync failed: ${failed[0].error}`
            : `Imported ${imported}, updated ${updated}.`,
        );
        load();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setSyncing(false));
  };

  const update = (id: number, patch: Partial<TeamEvent>) =>
    api.patch(`/events/${id}`, patch).then(load).catch((err: Error) => setError(err.message));

  const primary = trainers.find((t) => t.isPrimary) ?? null;

  const applyPrimary = () =>
    api
      .post<{ updated: number; trainer: string }>(`/seasons/${ctx.season.id}/apply-primary-trainer`)
      .then((r) => {
        setStatus(`Attached ${r.trainer} to ${r.updated} event${r.updated === 1 ? '' : 's'}.`);
        load();
      })
      .catch((err: Error) => setError(err.message));

  const counts = {
    game: events.filter((e) => e.type === 'game' && !e.cancelled).length,
    practice: events.filter((e) => e.type === 'practice' && !e.cancelled).length,
    tournament: events.filter((e) => e.type === 'tournament' && !e.cancelled).length,
  };
  const scheduledCost = events.reduce((s, e) => s + (e.cancelled ? 0 : e.costCents), 0);

  return (
    <>
      {error && <div className="error">{error}</div>}

      <div className="stat-row">
        <div className="stat">
          <div className="label">Games</div>
          <div className="value">{counts.game}</div>
        </div>
        <div className="stat">
          <div className="label">Practices</div>
          <div className="value">{counts.practice}</div>
        </div>
        <div className="stat">
          <div className="label">Tournaments</div>
          <div className="value">{counts.tournament}</div>
        </div>
        <div className="stat">
          <div className="label">Cost from schedule</div>
          <div className="value">{fmt(scheduledCost)}</div>
        </div>
      </div>

      <div className="panel">
        <div className="form-row">
          <button className="primary" onClick={() => setAdding((a) => !a)}>
            {adding ? 'Cancel' : 'Add event'}
          </button>
          <button onClick={syncAll} disabled={syncing || feeds.length === 0}>
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          {primary && (
            <button onClick={applyPrimary} title={`Attach ${primary.name} to every event with no trainer`}>
              Attach {primary.name} to unassigned
            </button>
          )}
          <span className="notice">
            {feeds.length === 0
              ? 'No calendar feed configured — add your calendar URL on the Settings page.'
              : `${feeds.length} feed${feeds.length > 1 ? 's' : ''}. Last sync: ${
                  feeds[0].lastSyncedAt ? new Date(feeds[0].lastSyncedAt).toLocaleString() : 'never'
                }`}
          </span>
        </div>
        {status && <p className="notice" style={{ marginBottom: 0 }}>{status}</p>}
        {feeds.some((f) => f.lastError) && (
          <p className="owes" style={{ fontSize: 13 }}>
            Last sync error: {feeds.find((f) => f.lastError)?.lastError}
          </p>
        )}
      </div>

      {adding && (
        <AddEvent
          seasonId={ctx.season.id}
          trainers={trainers}
          primary={primary}
          onDone={() => {
            setAdding(false);
            load();
          }}
        />
      )}

      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Event</th>
              <th>Type</th>
              <th className="hide-sm">Trainer</th>
              <th className="num">Cost</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr><td colSpan={6} className="muted">Nothing on the schedule yet.</td></tr>
            )}
            {events.map((e) => (
              <tr key={e.id}>
                <td className="muted">
                  {new Date(e.startsAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </td>
                <td>
                  <span className={e.cancelled ? 'badge strike grey' : ''}>{e.title}</span>
                  {e.location && <div className="muted" style={{ fontSize: 12 }}>{e.location}</div>}
                </td>
                <td>
                  <select
                    value={e.type}
                    onChange={(ev) => update(e.id, { type: ev.target.value as TeamEvent['type'] })}
                  >
                    {TYPES.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  {!e.typeConfirmed && (
                    <div className="derived" title="Guessed from the calendar title — confirm by choosing a type">
                      guessed
                    </div>
                  )}
                </td>
                <td className="hide-sm">
                  <select
                    value={e.trainerId ?? ''}
                    onChange={(ev) =>
                      update(e.id, { trainerId: ev.target.value ? Number(ev.target.value) : null })
                    }
                  >
                    <option value="">—</option>
                    {trainers.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </td>
                <td className="num">{e.cancelled ? <span className="muted">—</span> : fmt(e.costCents)}</td>
                <td className="num">
                  <button className="link" onClick={() => update(e.id, { cancelled: !e.cancelled })}>
                    {e.cancelled ? 'Restore' : 'Cancel'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="notice">
          Cancelled events stop costing the team. Choosing a type pins it, so the next sync will
          not change it back.
        </p>
      </div>

      <Collapsible
        title="Per-event overrides"
        hint={
          (() => {
            const n = events.reduce((s, e) => s + e.charges.filter((c) => c.overridden).length, 0);
            return n ? (
              <span className="badge">{n} overridden</span>
            ) : (
              <span className="muted">— none</span>
            );
          })()
        }
      >
        <div className="panel">
          <p className="notice" style={{ marginTop: 0 }}>
            Use these when one event cost something different — a ref who still charged for a
            rained-out game, or a session the trainer comped.
          </p>
          <Overrides events={events} onChanged={load} />
        </div>
      </Collapsible>
    </>
  );
}

// Events that never came from the calendar feed: a scrimmage arranged by text,
// a tournament weekend, an extra session added late.
function AddEvent({
  seasonId,
  trainers,
  primary,
  onDone,
}: {
  seasonId: number;
  trainers: Trainer[];
  primary: Trainer | null;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('18:00');
  const [type, setType] = useState<TeamEvent['type']>('practice');
  const [location, setLocation] = useState('');
  // Blank means "use the primary trainer", which the server applies.
  const [trainerId, setTrainerId] = useState('');
  const [repeat, setRepeat] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Weekly repeat, because a practice is almost never a one-off and adding
      // twelve of them by hand is the reason people stay in a spreadsheet.
      const start = new Date(`${date}T${time}`);
      for (let i = 0; i < repeat; i += 1) {
        const when = new Date(start);
        when.setDate(when.getDate() + i * 7);
        await api.post(`/seasons/${seasonId}/events`, {
          title: repeat > 1 ? `${title} ${i + 1}` : title,
          startsAt: when.toISOString(),
          type,
          location: location || null,
          trainerId: trainerId ? Number(trainerId) : null,
        });
      }
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={submit}>
      <h2 style={{ marginTop: 0 }}>Add event</h2>
      {error && <div className="error">{error}</div>}
      <div className="form-row">
        <div className="field" style={{ flex: 2, minWidth: 160 }}>
          <label>Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Practice"
            required
            autoFocus
          />
        </div>
        <div className="field">
          <label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as TeamEvent['type'])}>
            {TYPES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div className="field" style={{ width: 110 }}>
          <label>Time</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </div>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <div className="field" style={{ flex: 1, minWidth: 140 }}>
          <label>Location</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="field">
          <label>Trainer</label>
          <select value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
            <option value="">{primary ? `${primary.name} (primary)` : 'None'}</option>
            {trainers.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ width: 130 }}>
          <label>Repeat weekly</label>
          <input
            type="number"
            min={1}
            max={52}
            value={repeat}
            onChange={(e) => setRepeat(Math.max(1, Number(e.target.value)))}
          />
        </div>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Adding…' : repeat > 1 ? `Add ${repeat} events` : 'Add event'}
        </button>
      </div>
    </form>
  );
}

function Overrides({ events, onChanged }: { events: TeamEvent[]; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const withCharges = events.filter((e) => e.charges.length > 0);

  if (withCharges.length === 0) {
    return <p className="muted" style={{ margin: 0 }}>No cost rules are matching any events yet.</p>;
  }

  const override = (chargeId: number, current: number) => {
    const input = prompt('New amount for this event:', (current / 100).toFixed(2));
    if (input === null) return;
    const cents = parseMoney(input);
    if (cents === null) return setError('Enter an amount like 75 or 0');
    setError(null);
    api
      .patch(`/event-charges/${chargeId}`, { amountCents: cents })
      .then(onChanged)
      .catch((err: Error) => setError(err.message));
  };

  const reset = (chargeId: number) =>
    api.post(`/event-charges/${chargeId}/reset`).then(onChanged).catch((err: Error) => setError(err.message));

  return (
    <>
      {error && <div className="error">{error}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th className="num">Charge</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {withCharges.map((e) =>
              e.charges.map((c) => (
                <tr key={c.id}>
                  <td>
                    {e.title}{' '}
                    <span className="muted" style={{ fontSize: 12 }}>
                      {new Date(e.startsAt).toLocaleDateString()}
                    </span>
                  </td>
                  <td className="num">
                    {fmt(c.amountCents)}
                    {c.overridden && <span className="badge" style={{ marginLeft: 6 }}>Override</span>}
                  </td>
                  <td className="num">
                    <button className="link" onClick={() => override(c.id, c.amountCents)}>Edit</button>
                    {c.overridden && (
                      <button className="link" onClick={() => reset(c.id)}>Reset</button>
                    )}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
