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
  onSelect,
  playbackMode,
  playStart,
  onPlaybackChange,
}: {
  day: Day;
  items: ScheduledItem[];
  provided: DroppableProvided;
  assetMap: Map<string, Asset>;
  categories: Category[];
  onSelect?: (assetId: string) => void;
  playbackMode?: 'loop' | 'playthru';
  playStart?: string;
  onPlaybackChange?: (mode: 'loop' | 'playthru', start?: string) => void;
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
        const category = categories.find(c => c.id === asset?.categoryId);
        const color = category?.color;
        return (
          <Draggable key={item.id} draggableId={`sched-${item.id}`} index={index}>
            {(provided) => (
              <div
                ref={provided.innerRef}
                {...provided.draggableProps}
                {...provided.dragHandleProps}
                className={`scheduled-item ${asset?.type ?? 'unknown'}`}
                title={asset?.name}
                style={{
                  height: durationToHeightPx(asset?.durationSec, false),
                  ...(color ? { borderLeftColor: color, borderLeftWidth: '6px' } : {})
                }}
                onClick={() => asset && onSelect?.(asset.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{asset?.name ?? 'Missing asset'}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {category && (
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: category.color,
                          border: '1px solid rgba(0,0,0,0.3)',
                          display: 'inline-block',
                          flexShrink: 0
                        }}
                        title={category.name}
                      />
                    )}
                    <span style={{ fontSize: 10, opacity: 0.7 }}>{asset?.durationSec ? formatDuration(asset.durationSec) : ''}</span>
                  </div>
                </div>
              </div>
            )}
          </Draggable>
        );
      })}
      {provided.placeholder}

      {/* Playback controls */}
      <div className="day-playback-controls">
        <label>Mode</label>
        <select
          value={playbackMode || 'loop'}
          onChange={(e) => onPlaybackChange?.(e.target.value as 'loop' | 'playthru', playStart)}
        >
          <option value="loop">Loop</option>
          <option value="playthru">Play Through</option>
        </select>
        {playbackMode === 'playthru' && (
          <>
            <label>Start</label>
            <input
              type="time"
              value={playStart || ''}
              onChange={(e) => onPlaybackChange?.('playthru', e.target.value)}
            />
          </>
        )}
      </div>
    </div>
  );
}
