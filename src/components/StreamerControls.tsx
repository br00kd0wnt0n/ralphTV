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
    <div style={{ background: '#e3f2fd', border: '1px solid #90caf9', borderRadius: 8, padding: 10, margin: '10px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <strong>Streamer</strong>
        <span style={{ fontSize: 12, color: running ? '#2e7d32' : '#d32f2f' }}>{running ? 'Running' : 'Stopped'}</span>
        <button onClick={async () => { await streamerStart(); refresh(); }} disabled={running}>Start</button>
        <button onClick={async () => { await streamerStop(); refresh(); }} disabled={!running}>Stop</button>
      </div>
      {current && (
        <div style={{ fontSize: 12, marginTop: 6 }}>Index {current.index} — asset {current.assetId}</div>
      )}
      {error && <div style={{ color: '#d32f2f', fontSize: 12 }}>{error}</div>}
    </div>
  );
}

