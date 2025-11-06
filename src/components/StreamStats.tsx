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
  connections: number;
}

export default function StreamStats() {
  const [stats, setStats] = useState<StreamStatsData>({
    bitrate: '--',
    fps: '--',
    resolution: '--',
    uptime: '--',
    codec: '--',
    connections: 0
  });
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    async function fetchStats() {
      try {
        const [streamer, relay] = await Promise.all([
          streamerStatus().catch(() => ({ running: false })),
          getRelayStatus().catch(() => ({ streaming: false }))
        ]);

        setIsStreaming(streamer.running && relay.streaming);

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
            resolution: relay.stats?.resolution || '1920x1080',
            uptime: uptimeStr,
            codec: relay.stats?.codec || 'H.264',
            connections: relay.stats?.connections || 1
          });
        } else {
          setStats({
            bitrate: '--',
            fps: '--',
            resolution: '--',
            uptime: '--',
            codec: '--',
            connections: 0
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
        <h4>Stream Stats</h4>
        <div className={`stream-stats-indicator ${isStreaming ? 'live' : 'offline'}`}>
          {isStreaming ? '● LIVE' : '○ OFFLINE'}
        </div>
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
          <div className="stream-stat-label">Viewers</div>
          <div className="stream-stat-value">{stats.connections}</div>
        </div>
      </div>
    </div>
  );
}
