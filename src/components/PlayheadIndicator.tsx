import React, { useEffect, useState } from 'react';
import { getStatusToday } from '../api/status';
import { CONFIG } from '../config';
import type { Day, ScheduledItem, Asset } from '../state/models';
import { durationToHeightPx } from '../state/schedule';

interface PlayheadData {
  day: Day;
  itemIndex: number;
  offsetSec: number;
}

export default function PlayheadIndicator({
  schedule,
  assetMap,
}: {
  schedule: Record<Day, ScheduledItem[]>;
  assetMap: Map<string, Asset>;
}) {
  const [playhead, setPlayhead] = useState<PlayheadData | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchStatus = async () => {
      if (!CONFIG.API_BASE_URL) return;
      try {
        const status = await getStatusToday(CONFIG.CHANNEL, CONFIG.WEEK);
        if (cancelled) return;

        // Find which day and item is currently playing
        if (status?.item && status?.day) {
          const day = status.day as Day;
          const items = schedule[day];
          const itemIndex = items.findIndex(it => it.assetId === status.item.assetId);

          if (itemIndex !== -1) {
            setPlayhead({
              day,
              itemIndex,
              offsetSec: status.offsetSec || 0
            });
          } else {
            setPlayhead(null);
          }
        } else {
          setPlayhead(null);
        }
      } catch (e) {
        // Silently handle errors
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 2000); // Update every 2 seconds

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [schedule]);

  if (!playhead) return null;

  // Calculate the vertical position of the playhead
  const items = schedule[playhead.day];
  let accumulatedHeight = 0;

  // Add heights of all items before the current one
  for (let i = 0; i < playhead.itemIndex; i++) {
    const asset = assetMap.get(items[i].assetId);
    accumulatedHeight += durationToHeightPx(asset?.durationSec, false);
    accumulatedHeight += 8; // margin between items (4px top + 4px bottom)
  }

  // Add the offset within the current item
  const currentAsset = assetMap.get(items[playhead.itemIndex].assetId);
  if (currentAsset?.durationSec) {
    const progress = playhead.offsetSec / currentAsset.durationSec;
    const itemHeight = durationToHeightPx(currentAsset.durationSec, false);
    accumulatedHeight += itemHeight * progress;
  }

  // Add header height (h4 + margin)
  const headerHeight = 32;
  const topPosition = headerHeight + accumulatedHeight;

  // Find the day column element to position relative to it
  const dayIndex = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(playhead.day);

  return (
    <div
      className="playhead-indicator"
      style={{
        position: 'absolute',
        left: `${dayIndex * 176 + 8}px`, // 160px min-width + 8px gap + 8px padding
        top: `${topPosition}px`,
        width: '160px',
        height: '3px',
        background: 'var(--brand-pink)',
        boxShadow: '0 0 8px var(--brand-pink)',
        zIndex: 100,
        pointerEvents: 'none',
        animation: 'pulse-playhead 1.5s ease-in-out infinite'
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: '-6px',
          top: '-3px',
          width: '0',
          height: '0',
          borderTop: '5px solid transparent',
          borderBottom: '5px solid transparent',
          borderLeft: '6px solid var(--brand-pink)'
        }}
      />
    </div>
  );
}
