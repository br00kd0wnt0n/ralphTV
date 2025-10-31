import React, { useMemo } from 'react';
import type { Day, ScheduledItem, Asset } from '../state/models';
import { DAYS } from '../state/models';
import { formatDuration } from '../state/schedule';

export default function WeekSummary({
  schedule,
  assetMap,
}: {
  schedule: Record<Day, ScheduledItem[]>;
  assetMap: Map<string, Asset>;
}) {
  const totalSec = useMemo(() => (
    DAYS.reduce((acc, d) => acc + schedule[d].reduce((s, it) => s + (assetMap.get(it.assetId)?.durationSec || 0), 0), 0)
  ), [schedule, assetMap]);
  return (
    <div className="week-summary">
      <strong>Week Total:</strong> {formatDuration(totalSec)}
    </div>
  );
}

