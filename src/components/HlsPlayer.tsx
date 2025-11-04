import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { CONFIG } from '../config';
import { getRelayStatus, checkRelayHealth } from '../api/relay';

interface HlsPlayerProps {
  onVideoReady?: (video: HTMLVideoElement) => void;
}

export default function HlsPlayer({ onVideoReady }: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [relayAvailable, setRelayAvailable] = useState(true);
  const [muted, setMuted] = useState(true); // Start muted to allow autoplay
  const [volume, setVolume] = useState(0.7);
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Expose video element to parent when ready
  useEffect(() => {
    if (videoRef.current && onVideoReady) {
      onVideoReady(videoRef.current);
    }
  }, [onVideoReady]);

  // Check relay health on mount
  useEffect(() => {
    if (!CONFIG.RELAY_BASE_URL) {
      setRelayAvailable(false);
      return;
    }

    const checkHealth = async () => {
      const health = await checkRelayHealth();
      setRelayAvailable(health.available);
      if (!health.available) {
        console.log('Relay service unavailable:', health.error);
      }
    };

    checkHealth();
  }, []);

  // Check relay status periodically
  useEffect(() => {
    if (!CONFIG.RELAY_BASE_URL || !relayAvailable) {
      return;
    }

    const checkStatus = async () => {
      try {
        const status = await getRelayStatus();
        if (!status.available) {
          // Relay is down, mark as unavailable
          setRelayAvailable(false);
          setStreaming(false);
          setError(null); // Suppress error display
          return;
        }
        setStreaming(status.streaming);
        if (!status.streaming && isPlaying) {
          // Stream stopped, pause video
          const video = videoRef.current;
          if (video) {
            video.pause();
            setIsPlaying(false);
          }
        }
      } catch (e) {
        console.warn('Failed to check relay status:', e);
        setStreaming(false);
      }
    };

    checkStatus();
    checkIntervalRef.current = setInterval(checkStatus, 3000);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, [isPlaying, relayAvailable]);

  // Load and play stream when streaming becomes active
  useEffect(() => {
    if (!CONFIG.RELAY_BASE_URL || !streaming || !relayAvailable) {
      // Clean up existing HLS instance if stream stopped
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const streamUrl = `${CONFIG.RELAY_BASE_URL}/hls/stream.m3u8`;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });

      hlsRef.current = hls;

      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS error:', data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log('Network error - retrying...');
              // Don't show error UI, just retry silently
              setTimeout(() => hls.startLoad(), 3000);
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('Media error - attempting recovery...');
              hls.recoverMediaError();
              break;
            default:
              // Only show error for non-recoverable issues
              console.error('Fatal HLS error');
              hls.destroy();
              break;
          }
        }
      });

      hls.on(Hls.Events.MANIFEST_PARSED, async () => {
        setError(null);
        // Auto-play muted (allowed by browsers)
        try {
          await video.play();
          setIsPlaying(true);
          // Try to unmute immediately
          if (video.muted) {
            video.muted = false;
            setMuted(false);
            setNeedsUnmute(false);
          }
        } catch (e) {
          console.warn('Autoplay blocked - waiting for user interaction:', e);
          setNeedsUnmute(true);
        }
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
      video.addEventListener('loadedmetadata', async () => {
        try {
          await video.play();
          setIsPlaying(true);
          // Try to unmute immediately
          if (video.muted) {
            video.muted = false;
            setMuted(false);
            setNeedsUnmute(false);
          }
        } catch (e) {
          console.warn('Autoplay blocked - waiting for user interaction:', e);
          setNeedsUnmute(true);
        }
      });
      video.addEventListener('error', () => {
        console.warn('Native HLS playback error');
      });
    } else {
      console.warn('HLS not supported in this browser');
    }
  }, [streaming, relayAvailable]);

  // Don't show player if relay is not available (suppress UI errors)
  if (!relayAvailable) {
    return null;
  }

  return (
    <div className="hls-player-container">
      <div className="hls-player-header">
        <h4>Live Stream Preview</h4>
      </div>

      <div className="hls-player-video">
        <video
          ref={videoRef}
          muted={muted}
          playsInline
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onClick={(e) => {
            // Allow click to play if autoplay was blocked or video is paused
            const video = e.currentTarget;
            setError(null); // Clear any error messages

            // If needs unmute, clicking enables audio
            if (needsUnmute && video.muted) {
              video.muted = false;
              setMuted(false);
              setNeedsUnmute(false);
              return;
            }

            if (video.paused && streaming) {
              video.play().then(() => {
                setIsPlaying(true);
              }).catch((err) => {
                console.warn('Manual play failed:', err);
              });
            } else if (!video.paused && streaming) {
              // If video is playing, clicking pauses it
              video.pause();
            }
          }}
        />
      </div>

      {!streaming && (
        <div className="hls-player-status">
          <div className="status-badge loading">Waiting for stream...</div>
        </div>
      )}

      {streaming && !isPlaying && (
        <div className="hls-player-status">
          <div className="status-badge loading">Click video to play</div>
        </div>
      )}

      {streaming && isPlaying && needsUnmute && (
        <div className="hls-player-status">
          <div className="status-badge loading" style={{ backgroundColor: '#ff9800' }}>
            Click video or adjust volume slider to enable audio
          </div>
        </div>
      )}

      <div className="hls-player-info">
        <div className="stream-url-info">
          {CONFIG.RELAY_BASE_URL ? (
            <>
              <span style={{ color: streaming ? 'var(--brand-teal)' : '#888', fontWeight: 'bold' }}>
                {streaming ? '● LIVE' : '○ Waiting'}
              </span>
              <span style={{ marginLeft: 8 }}>{CONFIG.RELAY_BASE_URL}/hls/stream.m3u8</span>
            </>
          ) : (
            <span style={{ color: '#d32f2f' }}>No relay configured</span>
          )}
        </div>
        <div className="hls-player-volume">
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => {
              const newVolume = parseFloat(e.target.value);
              setVolume(newVolume);
              if (videoRef.current) {
                videoRef.current.volume = newVolume;
                // If adjusting volume, unmute the video
                if (needsUnmute || videoRef.current.muted) {
                  videoRef.current.muted = false;
                  setMuted(false);
                  setNeedsUnmute(false);
                }
              }
              if (newVolume === 0) {
                setMuted(true);
              } else if (muted) {
                setMuted(false);
              }
            }}
            className="volume-slider"
            title="Volume"
          />
        </div>
      </div>
    </div>
  );
}
