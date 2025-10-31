import React, { useEffect, useMemo, useState } from 'react';
import { getStatusToday } from '../api/status';
import { getPlaylistToday } from '../api/feed';
import { streamerStatus } from '../api/streamer';
import { CONFIG } from '../config';
import type { Asset } from '../state/models';
import { formatDuration } from '../state/schedule';

export default function OnAirTile({ assetMap }: { assetMap: Map<string, Asset> }) {
  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!CONFIG.API_BASE_URL) return;
      try {
        // Prefer streamer heartbeat if available
        let s: any | null = null;
        try { s = await streamerStatus(); } catch {}
        if (!s || !s.running) {
          s = await getStatusToday(CONFIG.CHANNEL, CONFIG.WEEK);
        } else if (s.current && s.current.startedAt) {
          const elapsed = Math.floor((Date.now() - s.current.startedAt) / 1000);
          s.offsetSec = elapsed;
          s.index = s.current.index;
          s.item = s.current.assetId ? { assetId: s.current.assetId, durationSec: 0 } : null;
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
    const t = setInterval(load, 15000);
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

  return (
    <div className="on-air-tile">
      <div className="on-air-badge">ON AIR</div>
      <div className="on-air-info">
        <div>{name}</div>
        <div className="on-air-progress">Elapsed {formatDuration(elapsed)} · Remaining {formatDuration(remaining)}</div>
        <div className="on-air-progress">Next: {nextName}</div>
      </div>
      {error && <div style={{ color: '#d32f2f', fontSize: 10 }}>{error}</div>}
    </div>
  );
}
