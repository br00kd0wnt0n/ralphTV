import React, { useEffect, useState, useMemo } from 'react';
import { streamerStatus, streamerStart, streamerStop, streamerRestart, streamerTestSignal } from '../api/streamer';
import { formatDuration } from '../state/schedule';
import type { Asset, Day, ScheduledItem } from '../state/models';
import { DAYS } from '../state/models';

export default function StreamerControls({
  assetMap,
  schedule
}: {
  assetMap: Map<string, Asset>;
  schedule: Record<Day, ScheduledItem[]>;
}) {
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

  const weekTotalSec = useMemo(() => (
    DAYS.reduce((acc, d) => acc + schedule[d].reduce((s, it) => s + (assetMap.get(it.assetId)?.durationSec || 0), 0), 0)
  ), [schedule, assetMap]);

  return (
    <div className="streamer-controls-container">
      <div className="streamer-controls-header">
        <h4>Streamer Controls</h4>
      </div>
      <div className="streamer-controls-content">
        <div className="streamer-controls-left">
          <div className="streamer-status-row">
            <span className="streamer-status-label">Status:</span>
            <span className={`streamer-status-badge ${running ? 'running' : 'stopped'}`}>
              {running ? 'Running' : 'Stopped'}
            </span>
          </div>
          <div className="streamer-buttons">
            <button className="btn" onClick={async () => { await streamerStart(); refresh(); }} disabled={running}>Start</button>
            <button className="btn" onClick={async () => { await streamerStop(); refresh(); }} disabled={!running}>Stop</button>
            <button className="btn" onClick={async () => { await streamerRestart(); setTimeout(refresh, 1200); }}>Restart</button>
            <button className="btn" onClick={async () => { await streamerTestSignal(30); refresh(); }}>Test Signal (30s)</button>
          </div>
          {running && current && (
            <div className="streamer-now-playing">
              #{current.index}: {assetName}
            </div>
          )}
          {error && <div className="streamer-error">{error}</div>}
        </div>
        <div className="streamer-controls-right">
          <div className="streamer-stat">
            <span className="streamer-stat-label">Session:</span>
            <span className="streamer-stat-value">{formatDuration(sessionSec)}</span>
          </div>
          <div className="streamer-stat">
            <span className="streamer-stat-label">Week:</span>
            <span className="streamer-stat-value">{formatDuration(weekTotalSec)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
