import { useState } from 'react';
import { api, type Season, type Team } from './api.js';

// Creating a team and creating a season are the same form: a season always
// belongs to a team, and a team with no season is a dead end you cannot
// navigate to. So one component covers both, and it is shared by the first-run
// Welcome screen and the Teams and seasons section in Settings — a treasurer
// running two teams needs the identical flow after setup that they got before
// it, and two copies of it would drift.
export default function TeamSeasonForm({
  teams,
  onCreated,
  submitLabel = 'Create',
  autoFocus = true,
}: {
  teams: Team[];
  // Handed the new season so the caller can jump straight into it.
  onCreated: (season: Season) => void;
  submitLabel?: string;
  autoFocus?: boolean;
}) {
  const [teamId, setTeamId] = useState<number | 'new'>(teams[0]?.id ?? 'new');
  const [name, setName] = useState('');
  const [ageGroup, setAgeGroup] = useState('');
  const [term, setTerm] = useState<Season['term']>('spring');
  const [year, setYear] = useState(new Date().getFullYear());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const id =
        teamId === 'new'
          ? (await api.post<Team>('/teams', { name, ageGroup: ageGroup || null })).id
          : teamId;
      const season = await api.post<Season>('/seasons', { teamId: id, term, year });
      onCreated(season);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      {error && <div className="error">{error}</div>}

      {teams.length > 0 && (
        <div className="field">
          <label htmlFor="team">Team</label>
          <select
            id="team"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value === 'new' ? 'new' : Number(e.target.value))}
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value="new">+ New team…</option>
          </select>
        </div>
      )}

      {teamId === 'new' && (
        <>
          <div className="field">
            <label htmlFor="name">Team name</label>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Riverside FC"
              required
              autoFocus={autoFocus}
            />
          </div>
          <div className="field">
            <label htmlFor="age">Age group (optional)</label>
            <input
              id="age"
              value={ageGroup}
              onChange={(e) => setAgeGroup(e.target.value)}
              placeholder="U14"
            />
          </div>
        </>
      )}

      <div className="form-row" style={{ marginBottom: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="term">Season</label>
          <select id="term" value={term} onChange={(e) => setTerm(e.target.value as Season['term'])}>
            <option value="spring">Spring</option>
            <option value="fall">Fall</option>
            <option value="summer">Summer</option>
            <option value="winter">Winter</option>
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="year">Year</label>
          <input
            id="year"
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            required
          />
        </div>
      </div>

      <button className="primary" type="submit" disabled={busy} style={{ width: '100%' }}>
        {busy ? 'Creating…' : submitLabel}
      </button>
    </form>
  );
}
