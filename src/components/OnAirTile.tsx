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
    <div className="on-air-tile">
      <div className="on-air-badge">ON AIR</div>
      <div className="on-air-info">
        <div>{name}</div>
        <div className="on-air-progress">Elapsed {formatDuration(elapsed)} · Remaining {formatDuration(remaining)}</div>
      </div>
      {error && <div style={{ color: '#d32f2f', fontSize: 10 }}>{error}</div>}
    </div>
  );
}

