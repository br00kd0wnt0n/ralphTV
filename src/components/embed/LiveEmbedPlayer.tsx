import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useHls } from '../../hooks/useHls';
import { CONFIG } from '../../config';
import '../../styles/embed-player.css';
// OverlayLayer intentionally omitted for v1 push

export default function LiveEmbedPlayer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [videoIsPlaying, setVideoIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(false);
  // Fixed landscape 16:9 for v1
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

  return (
    <div
      ref={containerRef}
      className={`embed-simple ${isFullscreen ? 'fullscreen-active' : ''}`}
      onMouseMove={() => setShowControls(true)}
      onTouchStart={() => setShowControls(true)}
    >
      <div className={`player-box landscape`}>
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
