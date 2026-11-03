import { useEffect, useState } from 'react';
import { fetchLive, StatsAuthError, type LiveNow } from '../../api/stats';

const POLL_MS = 15_000;

/** "Watching now": sessions with a heartbeat in the last ~45s. Polls while the tab is visible. */
export default function LiveTile({ onAuthError }: { onAuthError: () => void }) {
  const [live, setLive] = useState<LiveNow | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const l = await fetchLive();
        if (alive) { setLive(l); setFailed(false); }
      } catch (e) {
        if (e instanceof StatsAuthError) onAuthError();
        else if (alive) setFailed(true);
      }
    };
    load();
    const t = setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', load);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', load); };
  }, [onAuthError]);

  const shows = new Map<string, number>();
  const devices = new Map<string, number>();
  for (const r of live?.rows ?? []) {
    if (r.name) shows.set(r.name, (shows.get(r.name) ?? 0) + r.n);
    devices.set(r.device, (devices.get(r.device) ?? 0) + r.n);
  }
  const deviceText = [...devices].map(([d, n]) => `${n} ${d}`).join(' · ');
  const showText = [...shows].sort((a, b) => b[1] - a[1]).map(([s]) => s)[0];

  return (
    <div className="stats-live" aria-live="polite">
      <span className={`stats-live-dot ${live?.total ? 'on' : ''}`} aria-hidden />
      <span className="stats-live-n">{failed ? '–' : live ? live.total : '…'}</span>
      <span className="stats-live-text">
        watching now
        {deviceText && <small>{deviceText}{showText ? ` · ${showText}` : ''}</small>}
      </span>
    </div>
  );
}
