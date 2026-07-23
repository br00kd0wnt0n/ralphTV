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
  onDelete,
  playbackMode,
  playStart,
  onPlaybackChange,
  playingItemId,
}: {
  day: Day;
  items: ScheduledItem[];
  provided: DroppableProvided;
  assetMap: Map<string, Asset>;
  categories: Category[];
  onSelect?: (assetId: string) => void;
  onDelete?: (itemId: string) => void;
  playbackMode?: 'loop' | 'playthru';
  playStart?: string;
  onPlaybackChange?: (mode: 'loop' | 'playthru', start?: string) => void;
  playingItemId?: string | null;
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
      {items.filter(item => item != null).map((item, index) => {
        const asset = assetMap.get(item.assetId);
        const category = categories.find(c => c.id === asset?.categoryId);
        const color = category?.color;
        const isPlaying = !!playingItemId && item.id === playingItemId;
        return (
          <Draggable key={item.id} draggableId={`sched-${item.id}`} index={index}>
            {(provided) => (
              <div
                ref={provided.innerRef}
                {...provided.draggableProps}
                {...provided.dragHandleProps}
                className={`scheduled-item ${asset?.type ?? 'unknown'}${isPlaying ? ' now-playing' : ''}`}
                title={asset?.name}
                style={{
                  height: durationToHeightPx(asset?.durationSec, false),
                  ...(color ? { borderLeft: `6px solid ${color}` } : {}),
                  ...provided.draggableProps.style
                }}
                onClick={(e) => {
                  // Don't trigger select if clicking delete button
                  if ((e.target as HTMLElement).closest('.delete-scheduled-item')) return;
                  asset && onSelect?.(asset.id);
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>
                    {asset?.name ?? 'Missing asset'}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
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
                    {onDelete && (
                      <button
                        className="delete-scheduled-item"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(item.id);
                        }}
                        title="Remove from schedule"
                        style={{
                          background: 'var(--brand-pink)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '2px',
                          width: 16,
                          height: 16,
                          fontSize: 10,
                          fontWeight: 'bold',
                          cursor: 'pointer',
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          marginLeft: 4
                        }}
                      >
                        ✕
                      </button>
                    )}
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
