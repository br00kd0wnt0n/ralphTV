import { useState, type FormEvent } from 'react';
import { statsLogin } from '../../api/stats';

/** Shared-password gate for /stats. No accounts: one password, read-only access. */
export default function StatsLogin({ onDone, notice }: { onDone: () => void; notice?: string }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(notice || '');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError('');
    try {
      await statsLogin(password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stats-login">
      <form onSubmit={submit} className="stats-card">
        <img src="/ralph-tv-logo.png" alt="Ralph TV" className="stats-login-logo" />
        <h1>Ralph TV stats</h1>
        <label htmlFor="stats-pw">Password</label>
        <input id="stats-pw" type="password" autoComplete="current-password" autoFocus
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="stats-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy || !password}>{busy ? 'Checking…' : 'Open stats'}</button>
      </form>
    </div>
  );
}
