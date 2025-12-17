import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { CONFIG } from '../config';
import { getRelayStatus } from '../api/relay';

export type LiveState = 'offline' | 'loading' | 'playing' | 'error' | 'idle';

interface UseHlsOpts {
  /** Optional override; defaults to `${CONFIG.RELAY_BASE_URL}/hls/stream.m3u8` */
  src?: string;
  /** When false, the hook tears down the player. */
  enabled?: boolean;
  /** Polling interval for relay status (ms). */
  statusIntervalMs?: number;
}

/** Minimal HLS lifecycle for an embeddable live player. */
export function useHls(video: HTMLVideoElement | null, opts: UseHlsOpts = {}) {
  const { enabled = true, statusIntervalMs = 5000 } = opts;
  const streamUrl = opts.src || (CONFIG.RELAY_BASE_URL ? `${CONFIG.RELAY_BASE_URL}/hls/stream.m3u8` : '');

  const hlsRef = useRef<Hls | null>(null);
  const statusTimer = useRef<number | null>(null);
  const [live, setLive] = useState(false);
  const [state, setState] = useState<LiveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const stoppedRef = useRef<boolean>(false);

  // Poll backend for relay streaming state (if API is configured)
  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    const tick = async () => {
      try {
        let backendLive: boolean | null = null;
        if (CONFIG.API_BASE_URL) {
          try {
            const res = await getRelayStatus();
            backendLive = !!res.streaming;
          } catch {
            backendLive = null;
          }
        }

        let probeLive: boolean | null = null;
        if (streamUrl) {
          try {
            const r = await fetch(streamUrl, { method: 'GET', cache: 'no-store' });
            if (r.ok) {
              const t = await r.text();
              probeLive = t.includes('#EXTM3U');
            } else {
              probeLive = false;
            }
          } catch {
            probeLive = false;
          }
        }

        if (!mounted) return;
        const anyLive = [backendLive, probeLive].some(v => v === true);
        const allFalse = [backendLive, probeLive].every(v => v === false);
        if (anyLive) setLive(true);
        else if (allFalse) setLive(false);
        // Gate network activity to avoid hammering relay when offline
        if (hlsRef.current) {
          if (anyLive) {
            try { hlsRef.current.startLoad(-1); stoppedRef.current = false; } catch {}
          } else if (allFalse && !stoppedRef.current) {
            try { hlsRef.current.stopLoad(); stoppedRef.current = true; } catch {}
          }
        }
        // Do not force state to 'offline' here; render logic can show fallback while allowing attach to proceed.
      } catch {
        if (mounted) setLive(false);
      }
    };
    tick();
    statusTimer.current = window.setInterval(tick, statusIntervalMs);
    return () => {
      mounted = false;
      if (statusTimer.current) window.clearInterval(statusTimer.current);
    };
  }, [enabled, statusIntervalMs, streamUrl]);

  // Initialize/destroy hls.js or native HLS
  useEffect(() => {
    if (!enabled || !video || !streamUrl) return;

    let cancelled = false;

    const attachNative = () => {
      video.src = streamUrl;
      const onLoaded = () => {
        if (cancelled) return;
        video.play().then(() => setState('playing')).catch(() => setState('idle'));
      };
      const onError = () => { if (!cancelled) setState('error'); };
      const onPlaying = () => { if (!cancelled) setLive(true); };
      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('error', onError);
      video.addEventListener('playing', onPlaying);
      return () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
        video.removeEventListener('playing', onPlaying);
      };
    };

    const attachHls = () => {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        capLevelToPlayerSize: true,
        liveSyncDurationCount: 3,
        maxBufferLength: 10,
        maxMaxBufferLength: 20,
      });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_LOADING, () => setState('loading'));
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLive(true);
        video.play().then(() => setState('playing')).catch(() => setState('idle'));
      });
      hls.on(Hls.Events.LEVEL_LOADED, () => { setLive(true); });
      hls.on(Hls.Events.FRAG_LOADED, () => { setLive(true); });
      hls.on(Hls.Events.BUFFER_APPENDED, () => { setLive(true); });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            setState('error');
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            setState('loading');
            hls.recoverMediaError();
          } else {
            setState('error');
            setError(data.details || 'fatal error');
          }
        }
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      return () => { hls.destroy(); hlsRef.current = null; };
    };

    setState('loading');
    setError(null);

    // If backend not available, probe manifest quickly to avoid long spinners
    const probe = async () => {
      if (!CONFIG.API_BASE_URL) {
        try {
          const r = await fetch(streamUrl, { method: 'GET' });
          if (!r.ok) setLive(false);
          else {
            const t = await r.text();
            setLive(t.includes('#EXTM3U'));
          }
        } catch { setLive(false); }
      }
    };
    probe();

    let cleanup: (() => void) | undefined;
    if (Hls.isSupported()) cleanup = attachHls();
    else if (video.canPlayType('application/vnd.apple.mpegurl')) cleanup = attachNative();
    else { setState('error'); setError('HLS not supported'); }

    return () => { cancelled = true; if (cleanup) cleanup(); };
  }, [enabled, video, streamUrl]);

  return { live, state, error } as const;
}
