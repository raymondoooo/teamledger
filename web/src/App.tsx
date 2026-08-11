import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, seasonLabel, type Season, type Team } from './api.js';
import Bank from './pages/Bank.js';
import Budget from './pages/Budget.js';
import Dashboard from './pages/Dashboard.js';
import Exports from './pages/Exports.js';
import Login from './pages/Login.js';
import PlayerDetail from './pages/PlayerDetail.js';
import Roster from './pages/Roster.js';
import Schedule from './pages/Schedule.js';
import Settings from './pages/Settings.js';
import Setup from './pages/Setup.js';
import Welcome from './pages/Welcome.js';

type AuthState = 'loading' | 'setup' | 'anonymous' | 'signed-in';

export type SeasonContext = {
  team: Team;
  season: Season;
  seasons: Season[];
  reload: () => void;
};

export default function App() {
  const [auth, setAuth] = useState<AuthState>('loading');
  const [teams, setTeams] = useState<Team[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonId, setSeasonId] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // Decide which of the three entry states we're in: an unconfigured
  // container, a logged-out browser, or a working session.
  useEffect(() => {
    api
      .get<{ configured: boolean }>('/setup/status')
      .then(({ configured }) => {
        if (!configured) return setAuth('setup');
        return api
          .get('/auth/me')
          .then(() => setAuth('signed-in'))
          .catch(() => setAuth('anonymous'));
      })
      .catch(() => setAuth('anonymous'));
  }, []);

  useEffect(() => {
    if (auth !== 'signed-in') return;
    Promise.all([api.get<Team[]>('/teams'), api.get<Season[]>('/seasons')])
      .then(([t, s]) => {
        setTeams(t);
        setSeasons(s);
        setSeasonId((current) => {
          if (current && s.some((x) => x.id === current)) return current;
          // Prefer the newest active season — the one being worked on now.
          return (s.find((x) => x.status === 'active') ?? s[0])?.id ?? null;
        });
      })
      .catch(() => undefined);
  }, [auth, reloadKey]);

  if (auth === 'loading') return <div className="centered muted">Loading…</div>;
  if (auth === 'setup') return <Setup onDone={() => setAuth('signed-in')} />;
  if (auth === 'anonymous') return <Login onDone={() => setAuth('signed-in')} />;

  const season = seasons.find((s) => s.id === seasonId) ?? null;
  const team = season ? teams.find((t) => t.id === season.teamId) ?? null : null;

  // No team yet — a freshly configured instance. Everything else needs a season
  // to hang off, so there is nothing to show but the create-first-team flow.
  if (!season || !team) {
    return <Welcome teams={teams} onCreated={reload} />;
  }

  const ctx: SeasonContext = { team, season, seasons, reload };

  const logout = () =>
    api.post('/auth/logout').then(() => {
      setAuth('anonymous');
      setTeams([]);
      setSeasons([]);
      setSeasonId(null);
    });

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">teamledger</div>
        <nav className="nav">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/budget">Budget</NavLink>
          <NavLink to="/roster">Roster</NavLink>
          <NavLink to="/schedule">Schedule</NavLink>
          <NavLink to="/bank">Bank</NavLink>
          <NavLink to="/exports">Exports</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div style={{ marginTop: 'auto', padding: '16px 20px 0' }}>
          <button className="link" onClick={logout}>Sign out</button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <h1>{team.name}</h1>
          <select
            value={season.id}
            onChange={(e) => setSeasonId(Number(e.target.value))}
            aria-label="Season"
          >
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {seasonLabel(s)}
                {s.status === 'closed' ? ' (closed)' : ''}
              </option>
            ))}
          </select>
          {season.status === 'closed' && <span className="badge grey">Closed</span>}
        </div>

        <Routes>
          <Route path="/" element={<Dashboard ctx={ctx} />} />
          <Route path="/budget" element={<Budget ctx={ctx} />} />
          <Route path="/roster" element={<Roster ctx={ctx} />} />
          <Route path="/roster/:playerId" element={<PlayerDetail ctx={ctx} />} />
          <Route path="/schedule" element={<Schedule ctx={ctx} />} />
          <Route path="/bank" element={<Bank ctx={ctx} />} />
          <Route path="/exports" element={<Exports ctx={ctx} />} />
          <Route path="/settings" element={<Settings ctx={ctx} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
