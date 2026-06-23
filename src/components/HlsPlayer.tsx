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
  // Default muted: browsers block autoplay for un-muted video, so an un-muted default
  // left the preview paused (looked like a frozen ~1fps feed). Unmute via the slider.
  const [muted, setMuted] = useState(true);
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
    let cancelled = false;

    // Wait — for as long as the stream is meant to be live — for the manifest to appear.
    // After Start the relay can take several seconds to produce its first segment;
    // giving up after ~5s (the old behavior) is exactly why the preview only came up
    // after a manual page refresh. The effect cleanup sets `cancelled`, so this stops
    // immediately when the stream goes offline (streaming → false).
    const checkHlsAvailability = async () => {
      while (!cancelled) {
        try {
          const response = await fetch(streamUrl, { method: 'GET', cache: 'no-store' });
          if (response.ok) {
            const text = await response.text();
            if (text.includes('#EXTM3U')) return true;
          }
        } catch (error) { /* manifest not ready yet */ }
        setStatusMessage('Waiting for stream…');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      return false;
    };

    // Initialize the player once the manifest is actually available.
    checkHlsAvailability().then((available) => {
      if (cancelled || !available) {
        isInitializingRef.current = false;
        return;
      }

      setPlayerStatus('initializing');
      setStatusMessage('Initializing HLS player...');

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        // Plain HLS (not LL-HLS). Use hls.js's well-tuned defaults and only sit a few
        // segments back from the live edge. Do NOT set liveMaxLatencyDurationCount above
        // the playlist length — targeting a latency the playlist can't hold makes the
        // player stall on rolled-off segments (the "1 frame every ~15s" symptom).
        lowLatencyMode: false,
        backBufferLength: 30,
        liveSyncDurationCount: 3,
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

      // Drive the buffering/playing badge off real <video> events, not off every
      // fragment load. The old FRAG_LOADING check compared a STALE playerStatus and
      // flashed "Buffering…" on every 1s segment even during smooth playback. Property
      // assignment (onX) replaces rather than stacks listeners across re-inits.
      video.onwaiting = () => { setPlayerStatus('buffering'); setStatusMessage('Buffering…'); };
      video.onplaying = () => { setPlayerStatus('playing'); setStatusMessage(''); };

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
      cancelled = true; // stop the manifest-wait loop when the stream goes offline
      isInitializingRef.current = false;
      if (videoRef.current) { videoRef.current.onwaiting = null; videoRef.current.onplaying = null; }
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
