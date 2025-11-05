import React, { useEffect, useMemo, useState } from 'react';
import { getStatusToday } from '../api/status';
import { getPlaylistToday } from '../api/feed';
import { streamerStatus } from '../api/streamer';
import { getRelayDestinations, getRelayStatus } from '../api/relay';
import { CONFIG } from '../config';
import type { Asset } from '../state/models';
import { formatDuration } from '../state/schedule';

export default function OnAirTile({ assetMap }: { assetMap: Map<string, Asset> }) {
  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<string[]>([]);
  const [streamerRunning, setStreamerRunning] = useState<boolean>(false);
  const [relayStreaming, setRelayStreaming] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!CONFIG.API_BASE_URL) return;
      try {
        // Prefer streamer heartbeat if available
        let s: any | null = null;
        try {
          s = await streamerStatus();
          if (!cancelled) setStreamerRunning(!!s?.running);
        } catch {
          if (!cancelled) setStreamerRunning(false);
        }

        if (!s || !s.running) {
          s = await getStatusToday(CONFIG.CHANNEL, CONFIG.WEEK);
        } else if (s.current && s.current.startedAt) {
          const elapsed = Math.floor((Date.now() - s.current.startedAt) / 1000);
          s.offsetSec = elapsed;
          s.index = s.current.index;

          // Look up the actual asset to get duration
          if (s.current.assetId) {
            const asset = assetMap.get(s.current.assetId);
            s.item = {
              assetId: s.current.assetId,
              durationSec: asset?.durationSec || 0,
              name: asset?.name
            };
          } else {
            s.item = null;
          }
        }
        if (!cancelled) { setStatus(s); setError(null); }
        // Fetch playlist for 'Next up'
        const pl = await getPlaylistToday(CONFIG.CHANNEL, CONFIG.WEEK).catch(() => null);
        if (!cancelled && pl && Array.isArray(pl.items)) setPlaylist(pl.items);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e));
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [assetMap]);

  // Fetch relay status and destinations
  useEffect(() => {
    if (!CONFIG.RELAY_BASE_URL) return;
    let cancelled = false;
    const loadRelay = async () => {
      try {
        const [statusRes, destRes] = await Promise.all([
          getRelayStatus(),
          getRelayDestinations()
        ]);
        if (!cancelled) {
          // Only update if relay is available, otherwise keep current state
          if (statusRes.available !== false) {
            setRelayStreaming(!!statusRes.streaming);
          }
          if (destRes.destinations) {
            setDestinations(destRes.destinations);
          }
        }
      } catch (e) {
        // Suppress errors - relay may be unavailable
        console.log('Relay info unavailable');
        if (!cancelled) setRelayStreaming(false);
      }
    };
    loadRelay();
    const t = setInterval(loadRelay, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const name = useMemo(() => {
    if (!status?.item) return '-';
    const a = assetMap.get(status.item.assetId);
    return a?.name || status.item.name || status.item.assetId;
  }, [status, assetMap]);

  const elapsed = status?.offsetSec || 0;
  const dur = status?.item?.durationSec || 0;
  const remaining = dur > elapsed ? (dur - elapsed) : 0;
  const [playlist, setPlaylist] = useState<any[] | null>(null);
  const nextName = useMemo(() => {
    if (!playlist || !playlist.length || typeof status?.index !== 'number') return '-';
    const nextIdx = (status.index + 1) % playlist.length;
    const next = playlist[nextIdx];
    if (!next) return '-';
    const a = assetMap.get(next.assetId);
    return a?.name || next.assetId;
  }, [playlist, status, assetMap]);

  // Determine if truly ON AIR (streamer running + relay streaming, or just streamer if no relay configured)
  const isOnAir = CONFIG.RELAY_BASE_URL
    ? (streamerRunning && relayStreaming)
    : streamerRunning;

  return (
    <div className="on-air-tile">
      <div className={`on-air-tile-header ${isOnAir ? 'on-air' : 'off-air'}`}>
        {isOnAir ? 'ON AIR' : 'OFF AIR'}
      </div>
      <div className="on-air-tile-content">
        <div className="on-air-info">
          <div className="on-air-now-playing">{name}</div>
          <div className="on-air-progress">Elapsed {formatDuration(elapsed)} · Remaining {formatDuration(remaining)}</div>
          <div className="on-air-progress">Next: {nextName}</div>
          {CONFIG.RELAY_BASE_URL && (
            <div className="on-air-relay-info" style={{ color: isOnAir ? 'var(--brand-teal)' : '#888' }}>
              {destinations.length > 0 ? (
                <>
                  Via Relay → {destinations.map((d, i) => (
                    <span key={i} style={{ textTransform: 'capitalize' }}>
                      {i > 0 && ', '}
                      {d}
                    </span>
                  ))}
                </>
              ) : (
                'Relay: No destinations'
              )}
              {!relayStreaming && streamerRunning && ' (waiting for stream...)'}
            </div>
          )}
        </div>
        {error && <div style={{ color: '#d32f2f', fontSize: 10 }}>{error}</div>}
      </div>
    </div>
  );
}
