import { useCallback, useEffect, useState } from 'react';
import type { SeasonContext } from '../App.js';
import {
  api,
  fmt,
  parseMoney,
  seasonLabel,
  type CostRule,
  type Feed,
  type Tournament,
  type Trainer,
} from '../api.js';
import TeamSeasonForm from '../TeamSeasonForm.js';
import { AddSection, Collapsible } from '../ui.js';

export default function Settings({ ctx }: { ctx: SeasonContext }) {
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [rules, setRules] = useState<CostRule[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [tourneys, setTourneys] = useState<Tournament[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api.get<Trainer[]>(`/teams/${ctx.team.id}/trainers`),
      api.get<CostRule[]>(`/seasons/${ctx.season.id}/cost-rules`),
      api.get<Feed[]>(`/seasons/${ctx.season.id}/feeds`),
      api.get<Tournament[]>(`/seasons/${ctx.season.id}/tournaments`),
    ])
      .then(([t, r, f, tn]) => {
        setTrainers(t);
        setRules(r);
        setFeeds(f);
        setTourneys(tn);
      })
      .catch((err: Error) => setError(err.message));
  }, [ctx.team.id, ctx.season.id]);

  useEffect(load, [load]);

  return (
    <>
      {error && <div className="error">{error}</div>}

      <TeamsAndSeasons ctx={ctx} />

      <AddSection
        title="Trainers and rates"
        addLabel="+ Add trainer"
        form={(close) => (
          <AddTrainer
            teamId={ctx.team.id}
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
              <th>Trainer</th>
              <th className="hide-sm">Initials</th>
              <th className="num">Rate</th>
              <th className="hide-sm">Per</th>
              <th className="num">Expected</th>
              <th className="hide-sm">Primary</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {trainers.length === 0 && (
              <tr><td colSpan={7} className="muted">No trainers yet.</td></tr>
            )}
            {trainers.map((t) => (
              <TrainerRow key={t.id} trainer={t} onSaved={load} />
            ))}
          </tbody>
        </table>
        <p className="notice">
          A trainer's rate is charged for <em>every</em> event they are attached to, whatever its
          type. The <strong>primary</strong> trainer is attached automatically to new events —
          imported from the calendar or added by hand — so a one-coach team never has to set it.
        </p>
      </AddSection>

      <AddSection
        title="Cost rules"
        addLabel="+ Add rule"
        form={(close) => (
          <AddCostRule
            seasonId={ctx.season.id}
            trainers={trainers}
            onAdded={() => {
              close();
              load();
            }}
          />
        )}
      >
        <p className="notice" style={{ marginTop: 0 }}>
          These turn the schedule into money. A per-session rule multiplies by how many matching
          events are on the calendar; a flat rule is a single season amount.
        </p>
        <table>
          <thead>
            <tr>
              <th>Rule</th>
              <th className="hide-sm">Applies to</th>
              <th className="hide-sm">Trainer</th>
              <th className="num">Amount</th>
              <th className="hide-sm">Per</th>
              <th className="num">Expected</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 && (
              <tr><td colSpan={7} className="muted">No rules yet — add one below.</td></tr>
            )}
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{r.label}</td>
                <td className="hide-sm">{r.eventType}</td>
                <td className="muted hide-sm">
                  {r.trainerId ? trainers.find((t) => t.id === r.trainerId)?.name ?? '—' : 'any'}
                </td>
                <td className="num">{fmt(r.amountCents)}</td>
                <td className="hide-sm">{r.unit === 'flat' ? 'season' : 'event'}</td>
                <td className="num">
                  {r.unit === 'flat' ? (
                    <span className="muted">—</span>
                  ) : (
                    <CountField
                      value={r.expectedCount}
                      onSave={(n) =>
                        api.patch(`/cost-rules/${r.id}`, { expectedCount: n }).then(load)
                      }
                    />
                  )}
                </td>
                <td className="num">
                  <button
                    className="link danger"
                    onClick={() =>
                      api.del(`/cost-rules/${r.id}`).then(load).catch((e: Error) => setError(e.message))
                    }
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </AddSection>

      <AddSection
        title="Tournaments"
        addLabel="+ Add tournament"
        form={(close) => (
          <AddTournament
            seasonId={ctx.season.id}
            onAdded={() => {
              close();
              load();
            }}
          />
        )}
      >
        <p className="notice" style={{ marginTop: 0 }}>
          Registration fees for tournaments you plan to enter. Mark one as an estimate if you
          have not booked it yet — it still counts toward the budget, so dues cover it.
        </p>
        <table>
          <thead>
            <tr>
              <th>Tournament</th>
              <th className="hide-sm">Dates</th>
              <th className="num">Registration</th>
              <th>Paid</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tourneys.length === 0 && (
              <tr><td colSpan={5} className="muted">None yet.</td></tr>
            )}
            {tourneys.map((t) => (
              <tr key={t.id}>
                <td>
                  {t.name}
                  {t.estimated && <span className="badge grey" style={{ marginLeft: 6 }}>Estimate</span>}
                </td>
                <td className="muted hide-sm">
                  {t.startDate ? `${t.startDate}${t.endDate ? ` – ${t.endDate}` : ''}` : '—'}
                </td>
                <td className="num">{fmt(t.registrationCents)}</td>
                <td>
                  <TournamentPaid tournament={t} onChanged={load} onError={setError} />
                </td>
                <td className="num">
                  <button
                    className="link danger"
                    onClick={() =>
                      api.del(`/tournaments/${t.id}`).then(load).catch((e: Error) => setError(e.message))
                    }
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {tourneys.length > 0 && (
              <tr className="subtotal">
                <td colSpan={2}>Total</td>
                <td className="num">
                  {fmt(tourneys.reduce((s, t) => s + t.registrationCents, 0))}
                </td>
                <td colSpan={2} />
              </tr>
            )}
          </tbody>
        </table>
      </AddSection>

      <Collapsible
        title="Calendar feed"
        hint={
          feeds.length ? (
            <span className="muted">— {feeds.length} feed{feeds.length > 1 ? 's' : ''}</span>
          ) : (
            <span className="muted">— not connected</span>
          )
        }
        open={feeds.length === 0}
      >
      <div className="panel">
        <p className="notice" style={{ marginTop: 0 }}>
          Any iCal (<code>.ics</code>) or <code>webcal://</code> link works. In TeamSnap, the one
          most teams have: open <strong>Schedule → Subscribe / Export</strong> and copy the link.
          Paste it here and teamledger will pull in games and practices to price them.
        </p>
        <table>
          <tbody>
            {feeds.map((f) => (
              <tr key={f.id}>
                <td style={{ wordBreak: 'break-all' }}>{f.label ?? f.url}</td>
                <td className="muted">
                  {f.lastSyncedAt ? new Date(f.lastSyncedAt).toLocaleString() : 'never synced'}
                </td>
                <td className="num">
                  <button
                    className="link danger"
                    onClick={() =>
                      api.del(`/feeds/${f.id}`).then(load).catch((e: Error) => setError(e.message))
                    }
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <AddFeed seasonId={ctx.season.id} onAdded={load} />
      </div>
      </Collapsible>

      <Collapsible
        title="Payment plan"
        hint={
          ctx.season.firstPaymentCents !== null ? (
            <span className="muted">— {fmt(ctx.season.firstPaymentCents)} first payment</span>
          ) : (
            <span className="muted">— all due at once</span>
          )
        }
      >
        <div className="panel">
          <PaymentPlan ctx={ctx} />
        </div>
      </Collapsible>

      <Collapsible
        title="Close season and roll over"
        hint={<span className="muted">— start the next season with this roster</span>}
      >
        <div className="panel">
          <Rollover ctx={ctx} />
        </div>
      </Collapsible>
    </>
  );
}

// A small number you can edit in place. Saves on blur or Enter so the estimate
// fields do not each need their own Save button.
// Adding a team or a season used to be possible only on the first-run Welcome
// screen, which stops rendering the moment you have a season — so a treasurer
// who took on a second team, or who wanted next season without closing this
// one, had nowhere to go. Rollover is not that: it closes the current season on
// purpose.
// Renaming the current season. A club that bills for the whole year does not
// think in "Fall 2026", and the label shows up on every statement a parent
// receives, so it needs to be theirs. Term and year stay underneath as the key.
function RenameSeason({ ctx }: { ctx: SeasonContext }) {
  const fallback = `${ctx.season.term.charAt(0).toUpperCase()}${ctx.season.term.slice(1)} ${ctx.season.year}`;
  const [name, setName] = useState(ctx.season.name ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = () => {
    setBusy(true);
    setErr(null);
    api
      .patch(`/seasons/${ctx.season.id}`, { name: name.trim() || null })
      .then(() => ctx.reload())
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div style={{ marginTop: 12 }}>
      {err && <div className="error">{err}</div>}
      <div className="form-row">
        <div className="field" style={{ flex: 1, maxWidth: 320 }}>
          <label htmlFor="seasonName">Name this season</label>
          <input
            id="seasonName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={fallback}
          />
        </div>
        <button onClick={save} disabled={busy} style={{ alignSelf: 'end', marginBottom: 2 }}>
          {busy ? 'Saving…' : 'Rename'}
        </button>
      </div>
      <p className="notice" style={{ marginTop: 0 }}>
        Shown everywhere instead of <strong>{fallback}</strong> — the season picker, exports and
        the statements you send parents. Leave it blank to go back to {fallback}.
      </p>
    </div>
  );
}

function TeamsAndSeasons({ ctx }: { ctx: SeasonContext }) {
  const byTeam = ctx.teams
    .map((t) => ({ team: t, list: ctx.seasons.filter((s) => s.teamId === t.id) }))
    .sort((a, b) => a.team.name.localeCompare(b.team.name));

  return (
    <AddSection
      title="Teams and seasons"
      addLabel="+ Add team or season"
      form={(close) => (
        <div style={{ marginBottom: 12, maxWidth: 440 }}>
          <TeamSeasonForm
            teams={ctx.teams}
            autoFocus={false}
            submitLabel="Create season"
            onCreated={(season) => {
              close();
              // Pull the new team/season into the app, then switch to it —
              // creating a season you are not taken to reads as a no-op.
              ctx.reload();
              ctx.selectSeason(season.id);
            }}
          />
        </div>
      )}
    >
      <table>
        <thead>
          <tr>
            <th>Team</th>
            <th className="hide-sm">Age group</th>
            <th>Seasons</th>
          </tr>
        </thead>
        <tbody>
          {byTeam.map(({ team, list }) => (
            <tr key={team.id}>
              <td>
                {team.name}
                {team.id === ctx.team.id && <span className="badge grey"> current</span>}
              </td>
              <td className="hide-sm">{team.ageGroup ?? '—'}</td>
              <td>
                {list.length
                  ? list.map((s) => (
                      <button
                        key={s.id}
                        className="link"
                        style={{ marginRight: 10 }}
                        onClick={() => ctx.selectSeason(s.id)}
                      >
                        {seasonLabel(s)}
                        {s.status === 'closed' ? ' (closed)' : ''}
                      </button>
                    ))
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <RenameSeason ctx={ctx} />
    </AddSection>
  );
}

function TournamentPaid({
  tournament,
  onChanged,
  onError,
}: {
  tournament: Tournament;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(tournament.paidOn ?? new Date().toISOString().slice(0, 10));

  if (editing) {
    return (
      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button
          className="link"
          onClick={() =>
            api
              .post(`/tournaments/${tournament.id}/pay`, { paidOn: date })
              .then(() => {
                setEditing(false);
                onChanged();
              })
              .catch((err: Error) => onError(err.message))
          }
        >
          Save
        </button>
        <button className="link" onClick={() => setEditing(false)}>Cancel</button>
      </span>
    );
  }

  if (tournament.paidOn) {
    return (
      <span style={{ whiteSpace: 'nowrap' }}>
        <span className="settled">{tournament.paidOn}</span>{' '}
        <button className="link" onClick={() => setEditing(true)}>edit</button>
        <button
          className="link danger"
          onClick={() =>
            api
              .post(`/tournaments/${tournament.id}/unpay`)
              .then(onChanged)
              .catch((err: Error) => onError(err.message))
          }
        >
          undo
        </button>
      </span>
    );
  }

  return <button className="link" onClick={() => setEditing(true)}>Mark paid</button>;
}

function CountField({ value, onSave }: { value: number; onSave: (n: number) => Promise<unknown> }) {
  const [text, setText] = useState(String(value));

  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 0 || n === value) return setText(String(value));
    onSave(n).catch(() => setText(String(value)));
  };

  return (
    <input
      type="number"
      min={0}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      style={{ width: 64, textAlign: 'right' }}
    />
  );
}

function AddTournament({ seasonId, onAdded }: { seasonId: number; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [fee, setFee] = useState('');
  const [estimated, setEstimated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseMoney(fee);
    if (cents === null) return setError('Enter a registration fee like 310');
    setError(null);
    api
      .post(`/seasons/${seasonId}/tournaments`, {
        name,
        startDate: startDate || null,
        endDate: endDate || null,
        registrationCents: cents,
        estimated,
      })
      .then(() => {
        setName('');
        setStartDate('');
        setEndDate('');
        setFee('');
        onAdded();
      })
      .catch((err: Error) => setError(err.message));
  };

  return (
    <form className="form-row" onSubmit={submit} style={{ marginTop: 12 }}>
      <div className="field" style={{ flex: 1, minWidth: 150 }}>
        <label>Tournament name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Easter" required />
      </div>
      <div className="field">
        <label>Starts</label>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </div>
      <div className="field">
        <label>Ends</label>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>
      <div className="field" style={{ width: 110 }}>
        <label>Registration</label>
        <input value={fee} onChange={(e) => setFee(e.target.value)} placeholder="310.00" required />
      </div>
      <div className="field">
        <label>&nbsp;</label>
        <label style={{ fontSize: 13, whiteSpace: 'nowrap', paddingBottom: 8 }}>
          <input
            type="checkbox"
            checked={estimated}
            onChange={(e) => setEstimated(e.target.checked)}
          />{' '}
          Estimate
        </label>
      </div>
      <button type="submit">Add</button>
      {error && <span className="owes" style={{ fontSize: 13 }}>{error}</span>}
    </form>
  );
}

function TrainerRow({ trainer, onSaved }: { trainer: Trainer; onSaved: () => void }) {
  const [rate, setRate] = useState((trainer.defaultRateCents / 100).toFixed(2));
  const [dirty, setDirty] = useState(false);

  const save = () => {
    const cents = parseMoney(rate);
    if (cents === null) return;
    api.patch(`/trainers/${trainer.id}`, { defaultRateCents: cents }).then(() => {
      setDirty(false);
      onSaved();
    });
  };

  return (
    <tr>
      <td>{trainer.name}</td>
      <td className="muted hide-sm">{trainer.initials ?? '—'}</td>
      <td className="num">
        <input
          value={rate}
          onChange={(e) => {
            setRate(e.target.value);
            setDirty(true);
          }}
          style={{ width: 90, textAlign: 'right' }}
        />
      </td>
      <td className="hide-sm">{trainer.rateUnit === 'flat' ? 'season' : 'session'}</td>
      <td className="num">
        {trainer.rateUnit === 'flat' ? (
          <span className="muted">—</span>
        ) : (
          <CountField
            value={trainer.expectedSessions}
            onSave={(n) =>
              api.patch(`/trainers/${trainer.id}`, { expectedSessions: n }).then(onSaved)
            }
          />
        )}
      </td>
      <td className="hide-sm">
        {trainer.isPrimary ? (
          <span className="badge">Primary</span>
        ) : (
          <button
            className="link"
            onClick={() => api.patch(`/trainers/${trainer.id}`, { isPrimary: true }).then(onSaved)}
          >
            Make primary
          </button>
        )}
      </td>
      <td className="num">
        <button className="link" onClick={save} disabled={!dirty}>Save</button>
      </td>
    </tr>
  );
}

function AddTrainer({ teamId, onAdded }: { teamId: number; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [initials, setInitials] = useState('');
  const [rate, setRate] = useState('');
  const [unit, setUnit] = useState<'per_session' | 'flat'>('per_session');
  const [expected, setExpected] = useState('0');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseMoney(rate) ?? 0;
    api
      .post(`/teams/${teamId}/trainers`, {
        name,
        initials: initials || null,
        defaultRateCents: cents,
        rateUnit: unit,
        expectedSessions: Math.max(0, Number(expected) || 0),
      })
      .then(() => {
        setName('');
        setInitials('');
        setRate('');
        setExpected('0');
        onAdded();
      });
  };

  return (
    <form className="form-row" onSubmit={submit} style={{ marginTop: 12 }}>
      <div className="field" style={{ flex: 1, minWidth: 140 }}>
        <label>Trainer name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="field" style={{ width: 80 }}>
        <label>Initials</label>
        <input value={initials} onChange={(e) => setInitials(e.target.value)} />
      </div>
      <div className="field" style={{ width: 100 }}>
        <label>Rate</label>
        <input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="200.00" />
      </div>
      <div className="field">
        <label>Per</label>
        <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}>
          <option value="per_session">Session</option>
          <option value="flat">Season</option>
        </select>
      </div>
      <div className="field" style={{ width: 90 }}>
        <label>Expected</label>
        <input
          type="number"
          min={0}
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          title="How many sessions you expect this season"
        />
      </div>
      <button type="submit">Add trainer</button>
    </form>
  );
}

function AddCostRule({
  seasonId,
  trainers,
  onAdded,
}: {
  seasonId: number;
  trainers: Trainer[];
  onAdded: () => void;
}) {
  const [kind, setKind] = useState<'ref_fee' | 'training'>('ref_fee');
  const [label, setLabel] = useState('');
  const [eventType, setEventType] = useState<CostRule['eventType']>('game');
  const [trainerId, setTrainerId] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<'per_session' | 'flat'>('per_session');
  const [expected, setExpected] = useState('0');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseMoney(amount);
    if (cents === null) return setError('Enter an amount like 75');
    setError(null);
    api
      .post(`/seasons/${seasonId}/cost-rules`, {
        kind,
        label,
        eventType,
        trainerId: trainerId ? Number(trainerId) : null,
        amountCents: cents,
        unit,
        expectedCount: Math.max(0, Number(expected) || 0),
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
        <label>Kind</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="ref_fee">Ref fee</option>
          <option value="training">Training</option>
        </select>
      </div>
      <div className="field" style={{ flex: 1, minWidth: 150 }}>
        <label>Label</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={kind === 'ref_fee' ? 'Ref fee' : 'Trainer sessions'}
          required
        />
      </div>
      <div className="field">
        <label>Applies to</label>
        <select value={eventType} onChange={(e) => setEventType(e.target.value as CostRule['eventType'])}>
          <option value="game">Games</option>
          <option value="practice">Practices</option>
          <option value="tournament">Tournaments</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div className="field">
        <label>Trainer</label>
        <select value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
          <option value="">Any</option>
          {trainers.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      <div className="field" style={{ width: 100 }}>
        <label>Amount</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="75.00" required />
      </div>
      <div className="field">
        <label>Per</label>
        <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}>
          <option value="per_session">Event</option>
          <option value="flat">Season</option>
        </select>
      </div>
      <div className="field" style={{ width: 90 }}>
        <label>Expected</label>
        <input
          type="number"
          min={0}
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          title="How many you expect this season, for budgeting before the schedule exists"
        />
      </div>
      <button type="submit">Add rule</button>
      {error && <span className="owes" style={{ fontSize: 13 }}>{error}</span>}
    </form>
  );
}

function AddFeed({ seasonId, onAdded }: { seasonId: number; onAdded: () => void }) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    api
      .post(`/seasons/${seasonId}/feeds`, { url, label: label || null })
      .then(() => {
        setUrl('');
        setLabel('');
        onAdded();
      })
      .catch((err: Error) => setError(err.message));
  };

  return (
    <form className="form-row" onSubmit={submit} style={{ marginTop: 12 }}>
      <div className="field" style={{ flex: 2, minWidth: 220 }}>
        <label>Calendar URL</label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="webcal://teamsnap.com/…"
          required
        />
      </div>
      <div className="field" style={{ flex: 1, minWidth: 120 }}>
        <label>Label</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="TeamSnap" />
      </div>
      <button type="submit">Add feed</button>
      {error && <span className="owes" style={{ fontSize: 13 }}>{error}</span>}
    </form>
  );
}

function PaymentPlan({ ctx }: { ctx: SeasonContext }) {
  const [first, setFirst] = useState(
    ctx.season.firstPaymentCents !== null ? (ctx.season.firstPaymentCents / 100).toFixed(2) : '',
  );
  const [firstDue, setFirstDue] = useState(ctx.season.firstPaymentDue ?? '');
  const [finalDue, setFinalDue] = useState(ctx.season.finalPaymentDue ?? '');
  const [status, setStatus] = useState<string | null>(null);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    api
      .patch(`/seasons/${ctx.season.id}`, {
        firstPaymentCents: first.trim() === '' ? null : parseMoney(first),
        firstPaymentDue: firstDue || null,
        finalPaymentDue: finalDue || null,
      })
      .then(() => {
        setStatus('Saved.');
        ctx.reload();
      })
      .catch((err: Error) => setStatus(err.message));
  };

  return (
    <form onSubmit={save}>
      <p className="notice" style={{ marginTop: 0 }}>
        Splits each player's dues into a first payment and a remainder. Leave blank if everything
        is due at once.
      </p>
      <div className="form-row">
        <div className="field" style={{ width: 120 }}>
          <label>First payment</label>
          <input value={first} onChange={(e) => setFirst(e.target.value)} placeholder="150.00" />
        </div>
        <div className="field">
          <label>First due</label>
          <input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />
        </div>
        <div className="field">
          <label>Final due</label>
          <input type="date" value={finalDue} onChange={(e) => setFinalDue(e.target.value)} />
        </div>
        <button className="primary" type="submit">Save</button>
        {status && <span className="notice">{status}</span>}
      </div>
    </form>
  );
}

function Rollover({ ctx }: { ctx: SeasonContext }) {
  const nextYear = ctx.season.term === 'fall' ? ctx.season.year + 1 : ctx.season.year;
  const [term, setTerm] = useState<'fall' | 'spring' | 'summer' | 'winter'>(
    ctx.season.term === 'spring' ? 'fall' : 'spring',
  );
  const [year, setYear] = useState(nextYear);
  const [carryPlayerBalances, setCarryPlayerBalances] = useState(true);
  const [carryTeamFunds, setCarryTeamFunds] = useState(true);
  const [copyCostRules, setCopyCostRules] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !confirm(
        `Close ${ctx.season.term} ${ctx.season.year} and start ${term} ${year}? ` +
          'The current season becomes read-only.',
      )
    ) {
      return;
    }
    setBusy(true);
    api
      .post<{ playersCarried: number; teamFundsCarriedCents: number }>(
        `/seasons/${ctx.season.id}/rollover`,
        { term, year, carryPlayerBalances, carryTeamFunds, copyCostRules },
      )
      .then((r) => {
        setStatus(
          `Rolled over ${r.playersCarried} players` +
            (r.teamFundsCarriedCents ? `, carrying ${fmt(r.teamFundsCarriedCents)} in team funds.` : '.'),
        );
        ctx.reload();
      })
      .catch((err: Error) => setStatus(err.message))
      .finally(() => setBusy(false));
  };

  if (ctx.season.status === 'closed') {
    return <p className="muted" style={{ margin: 0 }}>This season is already closed.</p>;
  }

  return (
    <form onSubmit={submit}>
      <p className="notice" style={{ marginTop: 0 }}>
        Closes this season and opens the next one with the same roster. Balances follow each
        player, so an overpayment becomes a credit against next season's dues.
      </p>
      <div className="form-row">
        <div className="field">
          <label>New season</label>
          <select value={term} onChange={(e) => setTerm(e.target.value as typeof term)}>
            <option value="spring">Spring</option>
            <option value="fall">Fall</option>
            <option value="summer">Summer</option>
            <option value="winter">Winter</option>
          </select>
        </div>
        <div className="field" style={{ width: 100 }}>
          <label>Year</label>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
        </div>
      </div>
      <div style={{ margin: '12px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label>
          <input
            type="checkbox"
            checked={carryPlayerBalances}
            onChange={(e) => setCarryPlayerBalances(e.target.checked)}
          />{' '}
          Carry each player's balance forward
        </label>
        <label>
          <input
            type="checkbox"
            checked={carryTeamFunds}
            onChange={(e) => setCarryTeamFunds(e.target.checked)}
          />{' '}
          Carry leftover team funds as a credit
        </label>
        <label>
          <input
            type="checkbox"
            checked={copyCostRules}
            onChange={(e) => setCopyCostRules(e.target.checked)}
          />{' '}
          Copy trainer rates and cost rules
        </label>
      </div>
      <button className="primary" type="submit" disabled={busy}>
        {busy ? 'Rolling over…' : 'Close season and roll over'}
      </button>
      {status && <p className="notice">{status}</p>}
    </form>
  );
}
