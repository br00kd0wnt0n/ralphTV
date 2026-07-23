import React, { useEffect, useState } from 'react';
import type { Day, ScheduledItem, Asset } from '../state/models';
import { durationToHeightPx } from '../state/schedule';
import type { NowPlaying } from '../hooks/useNowPlaying';

/**
 * Renders the horizontal "playhead" line at the current playback position within the
 * schedule. The current slot + offset is supplied by the parent (via useNowPlaying),
 * so this component only handles positioning/rendering.
 */
export default function PlayheadIndicator({
  schedule,
  assetMap,
  playhead,
}: {
  schedule: Record<Day, ScheduledItem[]>;
  assetMap: Map<string, Asset>;
  playhead: NowPlaying | null;
}) {
  const [leftPosition, setLeftPosition] = useState<number | null>(null);
  const [columnWidth, setColumnWidth] = useState(160);

  // Calculate horizontal position dynamically from the DOM.
  useEffect(() => {
    if (!playhead) return;

    const updatePosition = () => {
      const scheduleGrid = document.querySelector('.schedule-grid');
      if (!scheduleGrid) return;
      const dayColumns = scheduleGrid.querySelectorAll('.schedule-day');
      const dayIndex = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(playhead.day);
      const dayColumn = dayColumns[dayIndex] as HTMLElement;
      if (dayColumn) {
        const gridRect = scheduleGrid.getBoundingClientRect();
        const columnRect = dayColumn.getBoundingClientRect();
        const left = columnRect.left - gridRect.left;
        const width = columnRect.width - 8;
        setLeftPosition(left + 4);
        setColumnWidth(width);
      }
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    const scheduleGrid = document.querySelector('.schedule-grid');
    let resizeObserver: ResizeObserver | null = null;
    if (scheduleGrid) {
      resizeObserver = new ResizeObserver(updatePosition);
      resizeObserver.observe(scheduleGrid);
    }
    return () => {
      window.removeEventListener('resize', updatePosition);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [playhead?.day]);

  if (!playhead || leftPosition === null) return null;

  // Vertical position: sum of item heights before the current one, plus the offset
  // within the current item.
  const items = schedule[playhead.day] || [];
  let accumulatedHeight = 0;
  for (let i = 0; i < playhead.itemIndex; i++) {
    if (!items[i]) continue;
    const asset = assetMap.get(items[i].assetId);
    accumulatedHeight += durationToHeightPx(asset?.durationSec, false);
    accumulatedHeight += 8; // margin between items (4px top + 4px bottom)
  }

  const currentItem = items[playhead.itemIndex];
  if (!currentItem) return null;
  const currentAsset = assetMap.get(currentItem.assetId);
  if (currentAsset?.durationSec) {
    const progress = playhead.offsetSec / currentAsset.durationSec;
    const itemHeight = durationToHeightPx(currentAsset.durationSec, false);
    accumulatedHeight += itemHeight * progress;
  }

  const headerHeight = 32; // day-column header (h4 + margin)
  const topPosition = headerHeight + accumulatedHeight;

  return (
    <div
      className="playhead-indicator"
      style={{
        position: 'absolute',
        left: `${leftPosition}px`,
        top: `${topPosition}px`,
        width: `${columnWidth}px`,
        height: '3px',
        background: 'var(--brand-pink)',
        boxShadow: '0 0 8px var(--brand-pink)',
        zIndex: 100,
        pointerEvents: 'none',
        animation: 'pulse-playhead 1.5s ease-in-out infinite',
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
          borderLeft: '6px solid var(--brand-pink)',
        }}
      />
    </div>
  );
}
