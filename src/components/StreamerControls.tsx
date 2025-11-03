import React, { useEffect, useState, useMemo } from 'react';
import { streamerStatus, streamerStart, streamerStop, streamerRestart, streamerTestSignal } from '../api/streamer';
import { formatDuration } from '../state/schedule';
import type { Asset } from '../state/models';

export default function StreamerControls({ assetMap }: { assetMap: Map<string, Asset> }) {
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

  const assetName = useMemo(() => {
    if (!current?.assetId) return null;
    const asset = assetMap.get(current.assetId);
    return asset?.name || current.assetId;
  }, [current, assetMap]);

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
      {running && current && (
        <div style={{ fontSize: 10, width: '100%', color: 'black', marginTop: 4 }}>
          Session {formatDuration(sessionSec)} · #{current.index}: {assetName}
        </div>
      )}
      {running && !current && (
        <div style={{ fontSize: 10, width: '100%', color: 'black', marginTop: 4 }}>Session {formatDuration(sessionSec)}</div>
      )}
      {error && <div style={{ color: '#d32f2f', fontSize: 10, width: '100%' }}>{error}</div>}
    </div>
  );
}
