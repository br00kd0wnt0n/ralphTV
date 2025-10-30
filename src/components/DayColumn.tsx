import React from 'react';
import { Draggable, DroppableProvided } from 'react-beautiful-dnd';
import type { Day, ScheduledItem, Asset, Category } from '../state/models';
import { durationToHeightPx, formatDuration } from '../state/schedule';

export default function DayColumn({
  day,
  items,
  provided,
  assetMap,
  categories,
  compact,
  onSelect,
}: {
  day: Day;
  items: ScheduledItem[];
  provided: DroppableProvided;
  assetMap: Map<string, Asset>;
  categories: Category[];
  compact?: boolean;
  onSelect?: (assetId: string) => void;
}) {
  const total = items.reduce((acc, it) => acc + (assetMap.get(it.assetId)?.durationSec || 0), 0);
  const unknown = items.filter(it => !assetMap.get(it.assetId)?.durationSec).length;

  return (
    <div
      className="schedule-day"
      ref={provided.innerRef}
      {...provided.droppableProps}
    >
      <h4>
        {day}
        <span style={{ float: 'right', fontWeight: 400, fontSize: 12 }}>
          {`${formatDuration(total)}${unknown ? ` (${unknown} unknown)` : ''}`}
        </span>
      </h4>
      {items.map((item, index) => {
        const asset = assetMap.get(item.assetId);
        const color = categories.find(c => c.id === asset?.categoryId)?.color;
        return (
          <Draggable key={item.id} draggableId={`sched-${item.id}`} index={index}>
            {(provided) => (
              <div
                ref={provided.innerRef}
                {...provided.draggableProps}
                {...provided.dragHandleProps}
                className={`scheduled-item ${asset?.type ?? 'unknown'}`}
                title={asset?.name}
                style={{ height: durationToHeightPx(asset?.durationSec, !!compact), borderLeftColor: color || undefined }}
                onClick={() => asset && onSelect?.(asset.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{asset?.name ?? 'Missing asset'}</span>
                  <span style={{ fontSize: 12, opacity: 0.7 }}>{asset?.durationSec ? formatDuration(asset.durationSec) : ''}</span>
                </div>
              </div>
            )}
          </Draggable>
        );
      })}
      {provided.placeholder}
    </div>
  );
}
