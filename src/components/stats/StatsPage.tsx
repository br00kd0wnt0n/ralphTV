import { useCallback, useEffect, useState } from 'react';
import {
  clearStatsToken, fetchOverview, fetchShows, getStatsToken, StatsAuthError,
  type Overview, type ShowRow, type Surface,
} from '../../api/stats';
import { RANGES, rangeDates, type RangeKey } from '../../state/statsFormat';
import StatsLogin from './StatsLogin';
import LiveTile from './LiveTile';
import StatsSections from './StatsSections';
import '../../styles/stats.css';

const SURFACES: { key: Surface; label: string }[] = [
  { key: 'tv', label: 'TV page' },
  { key: 'home', label: 'Homepage teaser' },
  { key: 'embed', label: 'Embed' },
  { key: 'all', label: 'All players' },
];

const PREFS_KEY = 'ralphTV.stats.prefs';

function loadPrefs(): { range: RangeKey; surface: Surface } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      range: RANGES.some((r) => r.key === p.range) ? p.range : '7d',
      surface: SURFACES.some((s) => s.key === p.surface) ? p.surface : 'tv',
    };
  } catch {
    return { range: '7d', surface: 'tv' };
  }
}

/** broadcaster.ralph.world/stats — viewer analytics behind one shared password. */
export default function StatsPage() {
  const [authed, setAuthed] = useState(() => Boolean(getStatsToken()));
  const [notice, setNotice] = useState('');
  const [{ range, surface }, setPrefs] = useState(loadPrefs);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [shows, setShows] = useState<ShowRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const onAuthError = useCallback(() => {
    clearStatsToken();
    setNotice('Your stats login expired — enter the password again.');
    setAuthed(false);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ range, surface })); } catch { /* ignore */ }
  }, [range, surface]);

  useEffect(() => {
    if (!authed) return;
    let alive = true;
    const { from, to } = rangeDates(range);
    setLoading(true);
    setError('');
    Promise.all([fetchOverview(from, to, surface), fetchShows(from, to, surface)])
      .then(([o, s]) => { if (alive) { setOverview(o); setShows(s); } })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof StatsAuthError) onAuthError();
        else setError(e instanceof Error ? e.message : 'Could not load stats');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [authed, range, surface, onAuthError]);

  if (!authed) return <StatsLogin notice={notice} onDone={() => { setNotice(''); setAuthed(true); }} />;

  return (
    <div className="stats-root">
      <header className="stats-header">
        <div className="stats-title">
          <img src="/ralph-tv-logo.png" alt="" className="stats-logo" />
          <div>
            <h1>Ralph TV stats</h1>
            <p className="stats-muted">Times in London. Anonymous: one visit = one page load.</p>
          </div>
        </div>
        <LiveTile onAuthError={onAuthError} />
      </header>

      <div className="stats-filters" role="toolbar" aria-label="Filters">
        <div className="stats-seg" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button key={r.key} type="button" aria-pressed={range === r.key}
              onClick={() => setPrefs((p) => ({ ...p, range: r.key }))}>{r.label}</button>
          ))}
        </div>
        <label className="stats-select">
          <span>Player</span>
          <select value={surface} onChange={(e) => setPrefs((p) => ({ ...p, surface: e.target.value as Surface }))}>
            {SURFACES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        {loading && <span className="stats-muted">Loading…</span>}
        <button type="button" className="stats-link"
          onClick={() => { clearStatsToken(); setNotice(''); setAuthed(false); }}>Log out</button>
      </div>

      {error && <p className="stats-error" role="alert">{error}</p>}
      {overview && <StatsSections overview={overview} shows={shows} />}
    </div>
  );
}
