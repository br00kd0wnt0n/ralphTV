import React, { useEffect, useMemo, useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';
import '../styles/content-scheduler.css';
import type { Day, Asset, ScheduledItem } from '../state/models';
import { DAYS } from '../state/models';
import { reorder, makeId, isDay } from '../state/schedule';
import UploadBar from './UploadBar';
import { loadAssets, loadSchedule, saveAssets, saveSchedule } from '../state/persistence';
import { CONFIG } from '../config';
import { getDaySchedule, putDaySchedule } from '../api/schedule';
import { RealtimeClient, buildScheduleTopic } from '../realtime/client';
import LibraryList from './LibraryList';
import { updateAssetTags } from '../api/assets';

export default function ContentScheduler() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [schedule, setSchedule] = useState<Record<Day, ScheduledItem[]>>({
    Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [], Sunday: []
  });
  const [versions, setVersions] = useState<Record<Day, number>>({
    Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0,
  });

  const assetMap = useMemo(() => new Map(assets.map(a => [a.id, a])), [assets]);
  const [rt, setRt] = useState<RealtimeClient | null>(null);

  const handleAssetUploaded = (asset: Asset) => {
    setAssets(prev => [...prev, asset]);
  };

  // Load persisted state once (prefer backend when enabled)
  useEffect(() => {
    const loadedAssets = loadAssets();
    if (loadedAssets.length) setAssets(loadedAssets);
    (async () => {
      if (CONFIG.USE_BACKEND_SCHEDULE && CONFIG.API_BASE_URL) {
        try {
          const entries = await Promise.all(
            DAYS.map(async (day) => [day, await getDaySchedule({ channel: CONFIG.CHANNEL, week: CONFIG.WEEK, day })] as const)
          );
          const nextSchedule = { ...schedule };
          const nextVersions = { ...versions };
          for (const [day, doc] of entries) {
            nextSchedule[day] = doc.items;
            nextVersions[day] = doc.version;
          }
          setSchedule(nextSchedule);
          setVersions(nextVersions);
          return;
        } catch (e) {
          // fall back to local storage
        }
      }
      const loadedSchedule = loadSchedule();
      if (loadedSchedule) setSchedule(loadedSchedule);
    })();
  }, []);

  // Persist on changes (small state; immediate save is fine)
  useEffect(() => { saveAssets(assets); }, [assets]);
  useEffect(() => { saveSchedule(schedule); }, [schedule]);

  // Realtime subscription (optional)
  useEffect(() => {
    if (!CONFIG.REALTIME_URL || !CONFIG.USE_BACKEND_SCHEDULE) return;
    const client = new RealtimeClient();
    setRt(client);
    const unsubs = DAYS.map((day) => {
      const topic = buildScheduleTopic(CONFIG.CHANNEL, CONFIG.WEEK, day);
      return client.subscribe(topic, (evt) => {
        // Expect evt.doc: { version, items }
        const doc = evt.doc || evt.data || evt;
        if (!doc || typeof doc.version === 'undefined' || !Array.isArray(doc.items)) return;
        setSchedule((prev) => ({ ...prev, [day]: doc.items }));
        setVersions((prev) => ({ ...prev, [day]: doc.version }));
      });
    });
    return () => { unsubs.forEach((u) => u()); client.disconnect(); };
  }, []);

  const saveDayToBackend = async (day: Day, items: ScheduledItem[]) => {
    if (!CONFIG.USE_BACKEND_SCHEDULE || !CONFIG.API_BASE_URL) return;
    try {
      const doc = await putDaySchedule({ channel: CONFIG.CHANNEL, week: CONFIG.WEEK, day, items, version: versions[day] || 0 });
      setVersions(prev => ({ ...prev, [day]: doc.version }));
    } catch {
      try {
        const latest = await getDaySchedule({ channel: CONFIG.CHANNEL, week: CONFIG.WEEK, day });
        setSchedule(prev => ({ ...prev, [day]: latest.items }));
        setVersions(prev => ({ ...prev, [day]: latest.version }));
      } catch {}
    }
  };

  const onDragEnd = (result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;

    // Same list reordering
    if (source.droppableId === destination.droppableId) {
      if (source.droppableId === 'library') {
        setAssets(prev => reorder(prev, source.index, destination.index));
      } else if (isDay(source.droppableId)) {
        const day = source.droppableId as Day;
        setSchedule(prev => ({
          ...prev,
          [day]: reorder(prev[day], source.index, destination.index)
        }));
      }
      return;
    }

    // Cross-list moves
    // From library -> day: add scheduled item referencing asset
    if (source.droppableId === 'library' && isDay(destination.droppableId)) {
      const assetId = draggableId.replace('asset-', '');
      const newItem: ScheduledItem = { id: makeId(), assetId };
      const day = destination.droppableId as Day;
      const dayList = Array.from(schedule[day]);
      dayList.splice(destination.index, 0, newItem);
      setSchedule(prev => ({ ...prev, [day]: dayList }));
      saveDayToBackend(day, dayList);
      return;
    }

    // From day -> day: move the scheduled item
    if (isDay(source.droppableId) && isDay(destination.droppableId)) {
      const sDay = source.droppableId as Day;
      const dDay = destination.droppableId as Day;
      const sourceList = Array.from(schedule[sDay]);
      const [moved] = sourceList.splice(source.index, 1);
      const destList = Array.from(schedule[dDay]);
      destList.splice(destination.index, 0, moved);
      setSchedule(prev => ({ ...prev, [sDay]: sourceList, [dDay]: destList }));
      saveDayToBackend(sDay, sourceList);
      if (dDay !== sDay) saveDayToBackend(dDay, destList);
      return;
    }

    // From day -> library: remove from schedule (library already has asset)
    if (isDay(source.droppableId) && destination.droppableId === 'library') {
      const sDay = source.droppableId as Day;
      const sourceList = Array.from(schedule[sDay]);
      sourceList.splice(source.index, 1);
      setSchedule(prev => ({ ...prev, [sDay]: sourceList }));
      saveDayToBackend(sDay, sourceList);
      return;
    }
  };

  return (
    <div className="content-scheduler container">
      <UploadBar onAssetUploaded={handleAssetUploaded} />

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="content-layout">
          {/* Library */}
          <Droppable droppableId="library">
            {(provided) => (
              <div
                className="uploaded-content"
                ref={provided.innerRef}
                {...provided.droppableProps}
              >
                <h3>Uploaded Content</h3>
                <LibraryList
                  assets={assets}
                  onChangeTags={(assetId, tags) => {
                    setAssets((prev) => prev.map((a) => a.id === assetId ? { ...a, tags } : a));
                    // Best-effort backend persistence when configured
                    if (CONFIG.API_BASE_URL) {
                      updateAssetTags({ assetId, tags }).catch(() => {});
                    }
                  }}
                />
                {provided.placeholder}
              </div>
            )}
          </Droppable>

          {/* Schedule Grid */}
          <div className="schedule-grid">
            {DAYS.map((day) => (
              <Droppable droppableId={day} key={day}>
                {(provided) => (
                  <div
                    className="schedule-day"
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                  >
                    <h4>{day}</h4>
                    {schedule[day].map((item, index) => {
                      const asset = assetMap.get(item.assetId);
                      return (
                        <Draggable key={item.id} draggableId={`sched-${item.id}`} index={index}>
                          {(provided) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={`scheduled-item ${asset?.type ?? 'unknown'}`}
                              title={asset?.name}
                            >
                              {asset?.name ?? 'Missing asset'}
                            </div>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            ))}
          </div>
        </div>
      </DragDropContext>
    </div>
  );
}
