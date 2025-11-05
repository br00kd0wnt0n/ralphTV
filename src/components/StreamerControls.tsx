import React, { useEffect, useState, useMemo } from 'react';
import { streamerStatus, streamerStart, streamerStop, streamerRestart, streamerTestSignal } from '../api/streamer';
import { logStreamAction, getLastStreamAction } from '../api/streamActions';
import { formatDuration } from '../state/schedule';
import type { Asset, Day, ScheduledItem } from '../state/models';
import { DAYS } from '../state/models';
import { getUserFromToken } from '../utils/jwt';
import { useAuth } from '../auth';

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
  const [lastAction, setLastAction] = useState<{ action: string; user_email: string; created_at: string } | null>(null);
  const [userHovered, setUserHovered] = useState(false);
  const auth = useAuth();
  const userInfo = getUserFromToken();

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

  async function fetchLastAction() {
    try {
      const data = await getLastStreamAction();
      setLastAction(data.action || null);
    } catch (e) {
      console.error('Failed to fetch last stream action:', e);
    }
  }

  useEffect(() => {
    refresh();
    fetchLastAction();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, []);

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
        {userInfo && (
          <div
            className="streamer-user-indicator"
            onMouseEnter={() => setUserHovered(true)}
            onMouseLeave={() => setUserHovered(false)}
            onClick={() => {
              if (userHovered && auth?.logout) {
                auth.logout();
                window.location.reload();
              }
            }}
          >
            {userHovered ? 'Log out' : `(${userInfo.email.split('@')[0]})`}
          </div>
        )}
      </div>
      <div className="streamer-controls-content">
        <div className="streamer-controls-main">
          <span className={`streamer-status-badge ${running ? 'running' : 'stopped'}`}>
            {running ? 'ON AIR' : 'OFF AIR'}
          </span>
          <div className="streamer-buttons">
            <button
              className="btn"
              onClick={async () => {
                await streamerStart();
                await logStreamAction('start').catch(console.error);
                refresh();
                fetchLastAction();
              }}
              disabled={running}
            >
              Start
            </button>
            <button
              className="btn"
              onClick={async () => {
                await streamerStop();
                await logStreamAction('stop').catch(console.error);
                refresh();
                fetchLastAction();
              }}
              disabled={!running}
            >
              Stop
            </button>
            <button
              className="btn"
              onClick={async () => {
                await streamerRestart();
                await logStreamAction('restart').catch(console.error);
                setTimeout(refresh, 1200);
                fetchLastAction();
              }}
            >
              Restart
            </button>
            <button className="btn" onClick={async () => { await streamerTestSignal(30); refresh(); }}>Test Signal (30s)</button>
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
        {running && current && (
          <div className="streamer-now-playing">
            #{current.index}: {assetName}
          </div>
        )}
        {error && <div className="streamer-error">{error}</div>}
        {lastAction && (
          <div className="streamer-last-action">
            Stream {lastAction.action === 'start' ? 'started' : lastAction.action === 'stop' ? 'stopped' : 'restarted'} at {new Date(lastAction.created_at).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' })}, by {lastAction.user_email}
          </div>
        )}
      </div>
    </div>
  );
}
