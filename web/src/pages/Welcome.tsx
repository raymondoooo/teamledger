import { useState } from 'react';
import { api, type Season, type Team } from '../api.js';

// Shown when the instance has an admin but no season to work on yet: either a
// brand-new install, or a team whose seasons were all deleted. Creates the team
// and its first season together, because one without the other is a dead end.
export default function Welcome({ teams, onCreated }: { teams: Team[]; onCreated: () => void }) {
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
      await api.post<Season>('/seasons', { teamId: id, term, year });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="centered">
      <form className="panel card" onSubmit={submit} style={{ maxWidth: 440 }}>
        <h1 style={{ marginBottom: 6 }}>{teams.length ? 'Start a season' : 'Add your team'}</h1>
        <p className="notice" style={{ marginTop: 0 }}>
          {teams.length
            ? 'Pick a team and the season you are budgeting for.'
            : 'One team and one season to start. You can add more of both later.'}
        </p>
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
                <option key={t.id} value={t.id}>{t.name}</option>
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
                autoFocus
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
          {busy ? 'Creating…' : 'Create'}
        </button>
      </form>
    </div>
  );
}
