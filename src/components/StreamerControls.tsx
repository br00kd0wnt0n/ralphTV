import React, { useEffect, useState } from 'react';
import { streamerStatus, streamerStart, streamerStop, streamerRestart, streamerTestSignal } from '../api/streamer';
import { formatDuration } from '../state/schedule';

export default function StreamerControls() {
  const [running, setRunning] = useState<boolean>(false);
  const [current, setCurrent] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const s = await streamerStatus();
      setRunning(!!s.running);
      setCurrent(s.current || null);
      setSessionSec(s.sessionTimeSec || 0);
      setError(null);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }

  useEffect(() => { refresh(); const t = setInterval(refresh, 10000); return () => clearInterval(t); }, []);

  const [sessionSec, setSessionSec] = useState<number>(0);

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
      <button className="win95-button" onClick={async () => { await streamerRestart(); setTimeout(refresh, 1200); }}>Restart</button>
      <button className="win95-button" onClick={async () => { await streamerTestSignal(30); refresh(); }}>Test Signal (30s)</button>
      {running && (
        <div style={{ fontSize: 10, width: '100%', color: 'black' }}>Session {formatDuration(sessionSec)}</div>
      )}
      {current && (
        <div style={{ fontSize: 10, width: '100%', color: 'black' }}>Index {current.index} — asset {current.assetId}</div>
      )}
      {error && <div style={{ color: '#d32f2f', fontSize: 10, width: '100%' }}>{error}</div>}
    </div>
  );
}
