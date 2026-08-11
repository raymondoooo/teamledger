import { useState } from 'react';
import { api } from '../api.js';

// First run. The container ships with an empty database and no credentials, so
// whoever reaches it first creates the single admin account. After that this
// screen is unreachable — /api/setup refuses once an admin exists.
export default function Setup({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    setError(null);
    api
      .post('/setup', { email, password })
      .then(onDone)
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="centered">
      <form className="panel card" onSubmit={submit}>
        <h1 style={{ marginBottom: 6 }}>Set up teamledger</h1>
        <p className="notice" style={{ marginTop: 0 }}>
          Create the treasurer account for this instance. This screen only appears once.
        </p>
        {error && <div className="error">{error}</div>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password (at least 8 characters)</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
        <button className="primary" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
    </div>
  );
}
