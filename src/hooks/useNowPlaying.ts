import { useEffect, useState } from 'react';
import { streamerStatus } from '../api/streamer';
import { getStatusToday } from '../api/status';
import { CONFIG } from '../config';
import type { Day, ScheduledItem, Asset } from '../state/models';

export interface NowPlaying {
  day: Day;
  itemIndex: number;
  offsetSec: number;
  assetId: string;
}

/**
 * Resolves what the streamer is currently playing to a specific schedule slot
 * ({ day, itemIndex }) so the UI can highlight it. Polls every 2s. Prefers the
 * streamer's own status (authoritative), falling back to the backend's time-based
 * status. Skips polling while the tab is hidden.
 */
export function useNowPlaying(
  schedule: Record<Day, ScheduledItem[]>,
  assetMap: Map<string, Asset>
): NowPlaying | null {
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchStatus = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        let currentAssetId: string | null = null;
        let offsetSec = 0;

        // Streamer status (via the authenticated backend proxy) is authoritative.
        if (CONFIG.API_BASE_URL) {
          try {
            const status = await streamerStatus();
            if (!cancelled && status?.running && status?.current?.assetId) {
              currentAssetId = status.current.assetId;
              if (status.current.startedAt) {
                const elapsed = Date.now() - status.current.startedAt;
                offsetSec = Math.max(0, Math.floor(elapsed / 1000));
                const asset = currentAssetId ? assetMap.get(currentAssetId) : undefined;
                if (asset?.durationSec) offsetSec = Math.min(offsetSec, asset.durationSec);
              }
            }
          } catch { /* streamer unreachable — fall back below */ }
        }

        // Fallback: backend time-based status.
        if (!currentAssetId && CONFIG.API_BASE_URL) {
          const status = await getStatusToday(CONFIG.CHANNEL, CONFIG.WEEK);
          if (!cancelled && status?.item?.assetId) {
            currentAssetId = status.item.assetId;
            offsetSec = status.offsetSec || 0;
          }
        }

        if (cancelled) return;

        if (currentAssetId) {
          let found: NowPlaying | null = null;
          for (const day of Object.keys(schedule) as Day[]) {
            const items = schedule[day] || [];
            const itemIndex = items.findIndex(it => it?.assetId === currentAssetId);
            if (itemIndex !== -1) {
              found = { day, itemIndex, offsetSec, assetId: currentAssetId };
              break;
            }
          }
          setNowPlaying(found);
        } else {
          setNowPlaying(null);
        }
      } catch {
        setNowPlaying(null);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [schedule, assetMap]);

  return nowPlaying;
}
