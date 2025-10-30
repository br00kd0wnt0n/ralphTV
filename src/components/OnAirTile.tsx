import React, { useEffect, useMemo, useState } from 'react';
import { getStatusToday } from '../api/status';
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
        const s = await getStatusToday(CONFIG.CHANNEL, CONFIG.WEEK);
        if (!cancelled) { setStatus(s); setError(null); }
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

  return (
    <div style={{ background: '#fff3e0', border: '1px solid #ffe0b2', borderRadius: 8, padding: 10, margin: '10px 0' }}>
      <div style={{ fontWeight: 600 }}>On Air</div>
      <div style={{ fontSize: 13 }}>{name}</div>
      <div style={{ fontSize: 12, opacity: 0.8 }}>Elapsed {formatDuration(elapsed)} · Remaining {formatDuration(remaining)}</div>
      {error && <div style={{ color: '#d32f2f', fontSize: 12 }}>{error}</div>}
    </div>
  );
}

