import { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    api
      .post('/auth/login', { email, password })
      .then(onDone)
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="centered">
      <form className="panel card" onSubmit={submit}>
        <h1 style={{ marginBottom: 16 }}>teamledger</h1>
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
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button className="primary" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {/* Sign-in screen only — deliberately nowhere that interrupts real use. */}
        <p className="notice" style={{ textAlign: 'center', marginBottom: 0 }}>
          <a href="https://ko-fi.com/raymondoooo" target="_blank" rel="noreferrer noopener">
            Support this project
          </a>
        </p>
      </form>
    </div>
  );
}
