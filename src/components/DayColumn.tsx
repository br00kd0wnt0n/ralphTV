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
  playbackMode,
  playStart,
  onChangePlayback,
}: {
  day: Day;
  items: ScheduledItem[];
  provided: DroppableProvided;
  assetMap: Map<string, Asset>;
  categories: Category[];
  playbackMode: 'loop'|'playthru';
  playStart?: string;
  onChangePlayback: (mode: 'loop'|'playthru', start?: string) => void;
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
                style={{ height: durationToHeightPx(asset?.durationSec), borderLeftColor: color || undefined }}
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
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ fontSize: 12 }}>Mode</label>
        <select value={playbackMode} onChange={(e) => onChangePlayback(e.target.value as any, playStart)} style={{ fontSize: 12 }}>
          <option value="loop">Looping</option>
          <option value="playthru">Play-through</option>
        </select>
        {playbackMode === 'playthru' && (
          <>
            <label style={{ fontSize: 12 }}>Start</label>
            <input type="time" value={playStart || ''} onChange={(e) => onChangePlayback('playthru', e.target.value)} style={{ fontSize: 12 }} />
          </>
        )}
      </div>
    </div>
  );
}
