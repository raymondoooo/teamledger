import { type Team } from '../api.js';
import TeamSeasonForm from '../TeamSeasonForm.js';

// Shown when the instance has an admin but no season to work on yet: either a
// brand-new install, or a team whose seasons were all deleted. Creates the team
// and its first season together, because one without the other is a dead end.
//
// The form itself is shared with Settings → Teams and seasons, which is how a
// treasurer adds their second team later.
export default function Welcome({ teams, onCreated }: { teams: Team[]; onCreated: () => void }) {
  return (
    <div className="centered">
      <div className="panel card" style={{ maxWidth: 440 }}>
        <h1 style={{ marginBottom: 6 }}>{teams.length ? 'Start a season' : 'Add your team'}</h1>
        <p className="notice" style={{ marginTop: 0 }}>
          {teams.length
            ? 'Pick a team and the season you are budgeting for.'
            : 'One team and one season to start. You can add more of both later.'}
        </p>
        <TeamSeasonForm teams={teams} onCreated={() => onCreated()} />
      </div>
    </div>
  );
}
