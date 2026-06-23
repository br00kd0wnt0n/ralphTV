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
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [playerStatus, setPlayerStatus] = useState<'idle' | 'initializing' | 'loading' | 'playing' | 'buffering' | 'error' | 'unstable'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastProgressRef = useRef<number>(0);
  const stallCheckRef = useRef<NodeJS.Timeout | null>(null);
  const isInitializingRef = useRef<boolean>(false);
  const fallbackUrl = React.useMemo(() => CONFIG.FALLBACK_GIF_URL || '/offline.gif', []);

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
        // Relay unavailable, silently noted
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
      if (typeof document !== 'undefined' && document.hidden) return; // skip while tab is backgrounded
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
      } catch {
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
      isInitializingRef.current = false;
      setPlayerStatus('idle');
      setStatusMessage('');
      return;
    }

    // Prevent re-initialization while already initializing
    if (isInitializingRef.current) return;

    const video = videoRef.current;
    if (!video) return;

    isInitializingRef.current = true;
    setPlayerStatus('initializing');
    setStatusMessage('Waiting for HLS segments...');
    const streamUrl = `${CONFIG.RELAY_BASE_URL}/hls/stream.m3u8`;

    // Wait for HLS manifest to be available before initializing player
    // Stream needs time to generate first segments (typically 2-5 seconds)
    const checkHlsAvailability = async () => {
      let attempts = 0;
      const maxAttempts = 10;

      while (attempts < maxAttempts) {
        try {
          // Use GET instead of HEAD since relay may return 200 for HEAD even when file doesn't exist
          const response = await fetch(streamUrl, { method: 'GET' });
          if (response.ok) {
            // Verify we actually got manifest content (should start with #EXTM3U)
            const text = await response.text();
            if (text.includes('#EXTM3U')) {
              return true;
            } else {
            }
          }
        } catch (error) {
          // Manifest not ready yet
        }
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 500));
        setStatusMessage(`Waiting for HLS segments... (${attempts}/${maxAttempts})`);
      }

      return false;
    };

    // Check availability then initialize player
    checkHlsAvailability().then((available) => {
      if (!available) {
        isInitializingRef.current = false;
        setPlayerStatus('error');
        setStatusMessage('HLS manifest not available');
        return;
      }

      setPlayerStatus('initializing');
      setStatusMessage('Initializing HLS player...');

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        // Reduced buffer settings for faster startup
        backBufferLength: 30,
        maxBufferLength: 10,
        maxMaxBufferLength: 20,
        maxLoadingDelay: 2,
        maxBufferingDelay: 3,
        // Live stream specific settings
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
      });

      hlsRef.current = hls;

      hls.on(Hls.Events.ERROR, (event, data) => {
        // Stream ended: when the broadcast stops, the relay 404s the live playlist.
        // hls.js reports this as a NON-fatal level/manifest load error and keeps
        // retrying on its own schedule, spamming 404s forever. Detect that specific
        // case and tear the player down quietly; the relay-status poll will bring it
        // back when the stream returns.
        if (
          data?.response?.code === 404 &&
          (data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR ||
            data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR)
        ) {
          if (retryTimeoutRef.current) { clearTimeout(retryTimeoutRef.current); retryTimeoutRef.current = null; }
          isInitializingRef.current = false;
          setIsPlaying(false);
          setPlayerStatus('idle');
          setStatusMessage('');
          setStreaming(false); // show "Waiting…"; poll re-inits when the stream is back
          try { hls.stopLoad(); } catch {}
          try { hls.destroy(); } catch {}
          if (hlsRef.current === hls) hlsRef.current = null;
          return;
        }
        // HLS error occurred
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              // Exponential backoff: 3s, 6s, 12s, 24s, 48s (max 5 retries)
              if (retryCountRef.current < 5) {
                const backoffDelay = Math.min(3000 * Math.pow(2, retryCountRef.current), 48000);
                // Network error - retrying with backoff
                setPlayerStatus('error');
                setStatusMessage(`Network error, retrying in ${backoffDelay / 1000}s... (${retryCountRef.current + 1}/5)`);
                retryCountRef.current++;
                if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
                retryTimeoutRef.current = setTimeout(() => {
                  setPlayerStatus('loading');
                  setStatusMessage('Retrying connection...');
                  hls.startLoad();
                }, backoffDelay);
              } else {
                // Max retries reached
                isInitializingRef.current = false;
                setPlayerStatus('error');
                setStatusMessage('Connection failed - max retries reached');
                hls.destroy();
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              // Media error - attempting recovery
              setPlayerStatus('unstable');
              setStatusMessage('Media error, recovering...');
              hls.recoverMediaError();
              break;
            default:
              // Only show error for non-recoverable issues
              // Fatal HLS error
              isInitializingRef.current = false;
              setPlayerStatus('error');
              setStatusMessage('Fatal playback error');
              hls.destroy();
              break;
          }
        }
      });

      hls.on(Hls.Events.MANIFEST_LOADING, () => {
        setPlayerStatus('loading');
        setStatusMessage('Loading stream manifest...');
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setError(null);
        // Reset retry count on successful load
        retryCountRef.current = 0;
        isInitializingRef.current = false; // Initialization complete
        setPlayerStatus('loading');
        setStatusMessage('Manifest loaded, starting playback...');
        // Auto-play when manifest is loaded
        video.play().then(() => {
          setIsPlaying(true);
          setPlayerStatus('playing');
          setStatusMessage('');
        }).catch((e) => {
          // Autoplay blocked - waiting for user interaction
          setPlayerStatus('idle');
          setStatusMessage('Click to play');
        });
      });

      hls.on(Hls.Events.FRAG_LOADING, () => {
        if (playerStatus !== 'playing') {
          setPlayerStatus('buffering');
          setStatusMessage('Buffering...');
        }
      });

      hls.on(Hls.Events.FRAG_LOADED, () => {
        if (!video.paused) {
          setPlayerStatus('playing');
          setStatusMessage('');
        }
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari)
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        video.play().then(() => {
          setIsPlaying(true);
          setPlayerStatus('playing');
          setStatusMessage('');
        }).catch((e) => {
          // Autoplay blocked - waiting for user interaction
          setPlayerStatus('idle');
          setStatusMessage('Click to play');
        });
      });
      video.addEventListener('error', () => {
        // Native HLS playback error
        isInitializingRef.current = false;
        setPlayerStatus('error');
        setStatusMessage('Playback error');
      });
      video.addEventListener('loadedmetadata', () => {
        isInitializingRef.current = false; // Initialization complete for Safari
      });
    } else {
      // HLS not supported
      isInitializingRef.current = false;
      setPlayerStatus('error');
      setStatusMessage('HLS not supported');
    }
    }); // End checkHlsAvailability().then()

    // Cleanup function
    return () => {
      isInitializingRef.current = false;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streaming, relayAvailable]);

  // Always show player container, even if relay unavailable (show status instead)

  return (
    <div className="hls-player-container">
      <div className="hls-player-header">
        <h4>Live Stream Preview</h4>
        {relayAvailable && streaming && statusMessage && (
          <div className={`header-status-badge status-${playerStatus}`}>
            {statusMessage}
          </div>
        )}
        {relayAvailable && streaming && !statusMessage && isPlaying && (
          <div className="header-status-badge status-playing">
            ● LIVE
          </div>
        )}
        {!relayAvailable && (
          <div className="header-status-badge status-offline">
            Relay Offline
          </div>
        )}
        {relayAvailable && !streaming && (
          <div className="header-status-badge status-idle">
            Waiting...
          </div>
        )}
      </div>

      <div className="hls-player-video">
        <video
          ref={videoRef}
          muted={muted}
          playsInline
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          style={{ opacity: (relayAvailable && streaming && playerStatus !== 'error') ? 1 : 0, transition: 'opacity 240ms ease' }}
          onClick={(e) => {
            // Allow click to play if autoplay was blocked or video is paused
            const video = e.currentTarget;
            setError(null); // Clear any error messages
            if (video.paused && streaming) {
              video.play().then(() => {
                setIsPlaying(true);
              }).catch((err) => {
                // Manual play failed
              });
            } else if (!video.paused && streaming) {
              // If video is playing, clicking pauses it
              video.pause();
            }
          }}
        />
        {/* Fallback overlay to mimic viewer experience when stream is offline */}
        <img
          src={fallbackUrl}
          alt="Stream offline"
          className="hls-fallback-overlay"
          style={{ opacity: (!relayAvailable || !streaming || playerStatus === 'error') ? 1 : 0 }}
        />
      </div>

      {relayAvailable && streaming && !isPlaying && !statusMessage && (
        <div className="hls-player-status">
          <div className="status-badge status-idle">Click video to play</div>
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
