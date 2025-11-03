import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { CONFIG } from '../config';

export default function HlsPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!CONFIG.RELAY_BASE_URL) {
      setError('No relay URL configured');
      setLoading(false);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const streamUrl = `${CONFIG.RELAY_BASE_URL}/hls/live.m3u8`;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });

      hlsRef.current = hls;

      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS error:', data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              setError('Network error - retrying...');
              setTimeout(() => hls.startLoad(), 3000);
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              setError('Media error - attempting recovery...');
              hls.recoverMediaError();
              break;
            default:
              setError('Fatal error - cannot play stream');
              hls.destroy();
              break;
          }
        }
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        setError(null);
        video.play().catch(() => {
          // Autoplay might be blocked - user needs to click play
        });
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      return () => {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari)
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        setLoading(false);
        video.play().catch(() => {
          // Autoplay might be blocked
        });
      });
      video.addEventListener('error', () => {
        setError('Error loading stream');
        setLoading(false);
      });
    } else {
      setError('HLS not supported in this browser');
      setLoading(false);
    }
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  return (
    <div className="hls-player-container">
      <div className="hls-player-header">
        <h4>Live Stream Preview</h4>
      </div>

      <div className="hls-player-video">
        <video
          ref={videoRef}
          controls
          muted
          playsInline
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      </div>

      {loading && (
        <div className="hls-player-status">
          <div className="status-badge loading">Loading stream...</div>
        </div>
      )}

      {error && (
        <div className="hls-player-status">
          <div className="status-badge error">{error}</div>
        </div>
      )}

      <div className="hls-player-controls">
        <button
          className="win95-button"
          onClick={togglePlay}
          disabled={!!error || loading}
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <div className="stream-url-info">
          {CONFIG.RELAY_BASE_URL ? (
            <span>{CONFIG.RELAY_BASE_URL}/hls/live.m3u8</span>
          ) : (
            <span style={{ color: '#d32f2f' }}>No relay configured</span>
          )}
        </div>
      </div>
    </div>
  );
}
