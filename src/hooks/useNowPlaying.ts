import { useEffect, useState } from 'react';
import { streamerStatus } from '../api/streamer';
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
        let currentDay: Day | null = null;
        let currentIndex: number | null = null;
        let offsetSec = 0;

        // Streamer status (via the authenticated backend proxy) is authoritative.
        if (CONFIG.API_BASE_URL) {
          try {
            const status = await streamerStatus();
            if (!cancelled && status?.running && status?.current?.assetId) {
              currentAssetId = status.current.assetId;
              currentDay = (status.current.day as Day) || null;
              currentIndex = typeof status.current.index === 'number' ? status.current.index : null;
              if (status.current.startedAt) {
                const elapsed = Date.now() - status.current.startedAt;
                offsetSec = Math.max(0, Math.floor(elapsed / 1000));
                const asset = currentAssetId ? assetMap.get(currentAssetId) : undefined;
                if (asset?.durationSec) offsetSec = Math.min(offsetSec, asset.durationSec);
              }
            }
          } catch { /* streamer unreachable — fall back below */ }
        }

        // NOTE: no time-based fallback here. "ON AIR" / the playhead must reflect what
        // the streamer is ACTUALLY playing — when it's stopped, show nothing rather
        // than a wall-clock guess (which misleadingly read "ON AIR" before Start).

        if (cancelled) return;

        if (currentAssetId) {
          let found: NowPlaying | null = null;
          // Prefer the exact day/index the streamer reported — an asset can appear on
          // several days, so a blind week-wide search would highlight the wrong one.
          if (currentDay && schedule[currentDay]) {
            const items = schedule[currentDay];
            if (currentIndex != null && items[currentIndex]?.assetId === currentAssetId) {
              found = { day: currentDay, itemIndex: currentIndex, offsetSec, assetId: currentAssetId };
            } else {
              const idx = items.findIndex(it => it?.assetId === currentAssetId);
              if (idx !== -1) found = { day: currentDay, itemIndex: idx, offsetSec, assetId: currentAssetId };
            }
          }
          // Fallback (older streamer without day, or day mismatch): week-wide search.
          if (!found) {
            for (const day of Object.keys(schedule) as Day[]) {
              const idx = (schedule[day] || []).findIndex(it => it?.assetId === currentAssetId);
              if (idx !== -1) { found = { day, itemIndex: idx, offsetSec, assetId: currentAssetId }; break; }
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
