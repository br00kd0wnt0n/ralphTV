import React, { useEffect, useState } from 'react';
import { streamerStatus, streamerStart, streamerStop } from '../api/streamer';

export default function StreamerControls() {
  const [running, setRunning] = useState<boolean>(false);
  const [current, setCurrent] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const s = await streamerStatus();
      setRunning(!!s.running);
      setCurrent(s.current || null);
      setError(null);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }

  useEffect(() => { refresh(); const t = setInterval(refresh, 10000); return () => clearInterval(t); }, []);

  return (
    <div className="streamer-controls">
      <h3>
        Streamer
        <span className={`streamer-status-badge ${running ? 'running' : 'stopped'}`}>
          {running ? 'Running' : 'Stopped'}
        </span>
      </h3>
      <button className="win95-button" onClick={async () => { await streamerStart(); refresh(); }} disabled={running}>Start</button>
      <button className="win95-button" onClick={async () => { await streamerStop(); refresh(); }} disabled={!running}>Stop</button>
      {current && (
        <div style={{ fontSize: 10, width: '100%', color: 'black' }}>Index {current.index} — asset {current.assetId}</div>
      )}
      {error && <div style={{ color: '#d32f2f', fontSize: 10, width: '100%' }}>{error}</div>}
    </div>
  );
}

