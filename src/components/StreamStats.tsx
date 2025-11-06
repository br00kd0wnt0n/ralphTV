import { useEffect, useState } from 'react';
import { streamerStatus } from '../api/streamer';
import { getRelayStatus } from '../api/relay';
import '../styles/stream-stats.css';

interface StreamStatsData {
  bitrate: string;
  fps: string;
  resolution: string;
  uptime: string;
  codec: string;
  dropped: string;
}

export default function StreamStats() {
  const [stats, setStats] = useState<StreamStatsData>({
    bitrate: '--',
    fps: '--',
    resolution: '--',
    uptime: '--',
    codec: '--',
    dropped: '--'
  });

  useEffect(() => {
    async function fetchStats() {
      try {
        const [streamer, relay] = await Promise.all([
          streamerStatus().catch(() => ({ running: false })),
          getRelayStatus().catch(() => ({ streaming: false }))
        ]);

        if (streamer.running && relay.streaming) {
          // Calculate uptime from session time
          const uptimeSeconds = streamer.sessionTimeSec || 0;
          const hours = Math.floor(uptimeSeconds / 3600);
          const minutes = Math.floor((uptimeSeconds % 3600) / 60);
          const seconds = Math.floor(uptimeSeconds % 60);
          const uptimeStr = hours > 0
            ? `${hours}h ${minutes}m ${seconds}s`
            : minutes > 0
            ? `${minutes}m ${seconds}s`
            : `${seconds}s`;

          setStats({
            bitrate: relay.stats?.bitrate || '2500 kbps',
            fps: relay.stats?.fps || '30',
            resolution: relay.stats?.resolution || '1280x720',
            uptime: uptimeStr,
            codec: relay.stats?.codec || 'H.264',
            dropped: relay.stats?.dropped || '0'
          });
        } else {
          setStats({
            bitrate: '--',
            fps: '--',
            resolution: '--',
            uptime: '--',
            codec: '--',
            dropped: '--'
          });
        }
      } catch (e) {
        console.error('Failed to fetch stream stats:', e);
      }
    }

    fetchStats();
    const interval = setInterval(fetchStats, 2000); // Update every 2 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="stream-stats-container">
      <div className="stream-stats-header">
        <h4>Live Stats</h4>
      </div>
      <div className="stream-stats-grid">
        <div className="stream-stat-item">
          <div className="stream-stat-label">Bitrate</div>
          <div className="stream-stat-value">{stats.bitrate}</div>
        </div>
        <div className="stream-stat-item">
          <div className="stream-stat-label">FPS</div>
          <div className="stream-stat-value">{stats.fps}</div>
        </div>
        <div className="stream-stat-item">
          <div className="stream-stat-label">Resolution</div>
          <div className="stream-stat-value">{stats.resolution}</div>
        </div>
        <div className="stream-stat-item">
          <div className="stream-stat-label">Codec</div>
          <div className="stream-stat-value">{stats.codec}</div>
        </div>
        <div className="stream-stat-item">
          <div className="stream-stat-label">Uptime</div>
          <div className="stream-stat-value">{stats.uptime}</div>
        </div>
        <div className="stream-stat-item">
          <div className="stream-stat-label">Dropped</div>
          <div className="stream-stat-value">{stats.dropped}</div>
        </div>
      </div>
    </div>
  );
}
