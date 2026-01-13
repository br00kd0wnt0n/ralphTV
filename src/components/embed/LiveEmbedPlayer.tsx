import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHls } from '../../hooks/useHls';
import { CONFIG } from '../../config';
import '../../styles/embed-player.css';
// OverlayLayer intentionally omitted for v1 push

/**
 * Detects content aspect ratio by sampling video edges for letterbox/pillarbox bars.
 * Returns 'portrait' if pillarboxed (black bars on sides), 'landscape' otherwise.
 */
function detectContentAspect(video: HTMLVideoElement): 'landscape' | 'portrait' {
  const { videoWidth, videoHeight } = video;
  if (!videoWidth || !videoHeight) {
    console.log('[AspectDetect] No video dimensions yet');
    return 'landscape';
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    console.log('[AspectDetect] Could not get canvas context');
    return 'landscape';
  }

  // Sample at smaller size for performance
  const sampleW = 160;
  const sampleH = Math.round((videoHeight / videoWidth) * sampleW);
  canvas.width = sampleW;
  canvas.height = sampleH;

  try {
    ctx.drawImage(video, 0, 0, sampleW, sampleH);

    // Check for pillarbox (black bars on left/right sides = portrait content)
    const leftEdge = ctx.getImageData(2, Math.floor(sampleH / 2), 1, 1).data;
    const rightEdge = ctx.getImageData(sampleW - 3, Math.floor(sampleH / 2), 1, 1).data;

    // Check for letterbox (black bars on top/bottom = landscape content in portrait container)
    const topEdge = ctx.getImageData(Math.floor(sampleW / 2), 2, 1, 1).data;
    const bottomEdge = ctx.getImageData(Math.floor(sampleW / 2), sampleH - 3, 1, 1).data;

    const isBlack = (rgba: Uint8ClampedArray) => rgba[0] < 20 && rgba[1] < 20 && rgba[2] < 20;

    const hasPillarbox = isBlack(leftEdge) && isBlack(rightEdge);
    const hasLetterbox = isBlack(topEdge) && isBlack(bottomEdge);

    console.log('[AspectDetect] Edges:', {
      left: Array.from(leftEdge.slice(0, 3)),
      right: Array.from(rightEdge.slice(0, 3)),
      top: Array.from(topEdge.slice(0, 3)),
      bottom: Array.from(bottomEdge.slice(0, 3)),
      hasPillarbox,
      hasLetterbox
    });

    // Pillarbox without letterbox means portrait content
    if (hasPillarbox && !hasLetterbox) {
      console.log('[AspectDetect] Detected: portrait');
      return 'portrait';
    }

    console.log('[AspectDetect] Detected: landscape');
    return 'landscape';
  } catch (err) {
    console.log('[AspectDetect] Canvas error (likely CORS):', err);
    return 'landscape';
  }
}

export default function LiveEmbedPlayer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [videoIsPlaying, setVideoIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [aspectMode, setAspectMode] = useState<'landscape' | 'portrait'>('landscape');
  const [volume, setVolume] = useState<number>(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('embed.vol') : null;
    return saved ? Math.min(1, Math.max(0, Number(saved))) : 0; // default 0 (muted) to maximize autoplay
  });

  // Allow query param override: ?src=<full.m3u8> or ?relay=<base-url>
  const srcOverride = (() => {
    if (typeof window === 'undefined') return undefined;
    const p = new URLSearchParams(window.location.search);
    const src = p.get('src');
    const relay = p.get('relay');
    if (src) return src;
    if (relay) return `${relay.replace(/\/$/, '')}/hls/stream.m3u8`;
    // Allow global injection if site wants to set it inline
    // @ts-ignore
    const g = (window as any).RALPH_RELAY_URL;
    if (g && typeof g === 'string') return `${g.replace(/\/$/, '')}/hls/stream.m3u8`;
    return undefined;
  })();

  const defaultBase = CONFIG.RELAY_BASE_URL ? `${CONFIG.RELAY_BASE_URL}/hls/stream.m3u8` : '';
  const { live, state } = useHls(videoRef.current, { enabled: true, src: srcOverride || defaultBase, statusIntervalMs: 2000 });
  const fallbackUrl = useMemo(() => CONFIG.FALLBACK_GIF_URL || '/offline.gif', []);

  // Sync initial volume/mute and persist changes
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = volume === 0;
  }, [volume]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('embed.vol', String(volume));
    }
  }, [volume]);

  // Play/pause based on intent
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [playing]);

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  };

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    // @ts-ignore Safari
    document.addEventListener('webkitfullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      // @ts-ignore Safari
      document.removeEventListener('webkitfullscreenchange', onFs);
    };
  }, []);

  // Replace video with fallback when stream is not live or errored
  const showFallback = (!live) || state === 'error';

  // Pause video when showing fallback
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (showFallback) {
      try { v.pause(); } catch {}
      setVideoIsPlaying(false);
    }
  }, [showFallback]);

  // Auto-hide center controls shortly after activity
  useEffect(() => {
    if (!showControls) return;
    const t = setTimeout(() => setShowControls(false), 2000);
    return () => clearTimeout(t);
  }, [showControls]);

  // When stream becomes live, attempt autoplay if user intent is playing
  useEffect(() => {
    if (!live) return;
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.play().catch(() => {});
    }
  }, [live, playing]);

  // Detect content aspect ratio by analyzing video frames for letterbox/pillarbox
  const detectAspect = useCallback(() => {
    const v = videoRef.current;
    if (!v || v.readyState < 2 || v.paused) return; // Need at least HAVE_CURRENT_DATA
    const detected = detectContentAspect(v);
    setAspectMode(detected);
  }, []);

  // Poll for aspect changes while video is playing (catches content transitions)
  useEffect(() => {
    if (!live || !videoIsPlaying) return;

    // Initial detection
    detectAspect();

    // Poll every 2 seconds to catch content changes
    const interval = setInterval(detectAspect, 2000);

    return () => clearInterval(interval);
  }, [live, videoIsPlaying, detectAspect]);

  // Also detect on video events
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onCanPlay = () => detectAspect();
    const onSeeked = () => detectAspect();

    v.addEventListener('canplay', onCanPlay);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('loadeddata', onCanPlay);

    return () => {
      v.removeEventListener('canplay', onCanPlay);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('loadeddata', onCanPlay);
    };
  }, [detectAspect]);

  return (
    <div
      ref={containerRef}
      className={`embed-simple ${isFullscreen ? 'fullscreen-active' : ''}`}
      onMouseMove={() => setShowControls(true)}
      onTouchStart={() => setShowControls(true)}
    >
      <div className={`player-box ${aspectMode}`}>
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted={volume === 0}
          onClick={() => setPlaying(p => !p)}
          crossOrigin="anonymous"
          onPlay={() => setVideoIsPlaying(true)}
          onPause={() => setVideoIsPlaying(false)}
          className="fade"
          style={{ opacity: showFallback ? 0 : 1 }}
        />
        <img
          className="embed-fallback overlay fade"
          src={fallbackUrl}
          alt="Live stream offline"
          style={{ opacity: showFallback ? 1 : 0 }}
        />
        {/* Overlays omitted in v1 push */}

        {/* Controls */}
        {!showFallback && ((!videoIsPlaying || !playing || showControls) && (
          <button
            className="overlay center-toggle"
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={() => setPlaying(p => !p)}
          >
            {playing ? '⏸' : '▶️'}
          </button>
        ))}
        <div className="overlay bottom-bar">
          <div className="vol">
            <span>🔊</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
            />
          </div>
          <div className="spacer" />
          <button className="btn" aria-label="Fullscreen" onClick={toggleFullscreen}>⛶</button>
        </div>
      </div>
    </div>
  );
}
