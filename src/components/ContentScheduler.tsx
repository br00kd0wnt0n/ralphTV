import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';
import '../styles/content-scheduler.css';
import '../styles/hls-player.css';
import '../styles/volume-visualizer.css';
import type { Day, Asset, ScheduledItem, Category } from '../state/models';
import { DAYS } from '../state/models';
import { reorder, makeId, isDay, formatDuration, durationToHeightPx } from '../state/schedule';
import { loadAssets, loadSchedule, saveAssets, saveSchedule, loadCategories, saveCategories } from '../state/persistence';
import { CONFIG } from '../config';
import { getDaySchedule, putDaySchedule } from '../api/schedule';
import { RealtimeClient, buildScheduleTopic } from '../realtime/client';
import LibraryList from './LibraryList';
import { listCategories, listAssets } from '../api/assets';
import CategoriesPanel from './CategoriesPanel';
import LibraryPanel from './LibraryPanel';
import DayColumn from './DayColumn';
import WeekSummary from './WeekSummary';
import { useDurationBackfill } from '../hooks/useDurationBackfill';
import StreamerControls from './StreamerControls';
import ScheduleDiagnostics from './ScheduleDiagnostics';
import PreviewPane from './PreviewPane';
import HlsPlayer from './HlsPlayer';
import VolumeVisualizer from './VolumeVisualizer';
import SystemStatus from './SystemStatus';
import StatusBadge from './StatusBadge';

export default function ContentScheduler() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [schedule, setSchedule] = useState<Record<Day, ScheduledItem[]>>({
    Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [], Sunday: []
  });
  const [versions, setVersions] = useState<Record<Day, number>>({
    Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0,
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [playback, setPlayback] = useState<Record<Day, { mode: 'loop'|'playthru'; start?: string }>>({
    Monday: { mode: 'loop' }, Tuesday: { mode: 'loop' }, Wednesday: { mode: 'loop' }, Thursday: { mode: 'loop' }, Friday: { mode: 'loop' }, Saturday: { mode: 'loop' }, Sunday: { mode: 'loop' },
  });
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [livestreamVideo, setLivestreamVideo] = useState<HTMLVideoElement | null>(null);

  const assetMap = useMemo(() => new Map(assets.map(a => [a.id, a])), [assets]);
  const [rt, setRt] = useState<RealtimeClient | null>(null);

  // Debounce timers for schedule saves (per day)
  const saveTimersRef = useRef<Record<Day, NodeJS.Timeout | null>>({
    Monday: null, Tuesday: null, Wednesday: null, Thursday: null,
    Friday: null, Saturday: null, Sunday: null
  });

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
          // Load schedule docs
          const entries = await Promise.all(
            DAYS.map(async (day) => [day, await getDaySchedule({ channel: CONFIG.CHANNEL, week: CONFIG.WEEK, day })] as const)
          );
          const nextSchedule = { ...schedule };
          const nextVersions = { ...versions };
          const nextPlayback = { ...playback };
          for (const [day, doc] of entries) {
            nextSchedule[day] = doc.items;
            nextVersions[day] = doc.version;
            if (doc.playbackMode) {
              nextPlayback[day] = { mode: doc.playbackMode, start: doc.playStart };
            }
          }
          setSchedule(nextSchedule);
          setVersions(nextVersions);
          setPlayback(nextPlayback);

          // Load categories
          try {
            const catRes = await listCategories();
            if (Array.isArray(catRes.categories)) setCategories(catRes.categories);
          } catch {}

          // Load assets (for durations, categories, tags)
          try {
            const assetRes = await listAssets();
            if (Array.isArray(assetRes.assets)) {
              const byId = new Map(assets.map(a => [a.id, a]));
              const merged: Asset[] = [];
              for (const a of assetRes.assets) {
                const existing = byId.get(a.id);
                const type = (a.file_type === 'video' || a.file_type === 'audio') ? a.file_type : 'unknown';
                const mapped: Asset = {
                  id: a.id,
                  name: existing?.name || a.file_name,
                  type,
                  url: existing?.url || '',
                  mimeType: a.mime_type,
                  size: Number(a.size),
                  s3Key: a.s3_key,
                  uploadedAt: a.uploaded_at,
                  tags: Array.isArray(a.tags) ? a.tags : [],
                  vimeoReference: a.vimeo_reference || undefined,
                  durationSec: typeof a.duration_sec === 'number' ? a.duration_sec : existing?.durationSec,
                  categoryId: a.category_id || existing?.categoryId,
                  normStatus: a.norm_status || existing?.normStatus,
                };
                merged.push(mapped);
                byId.delete(a.id);
              }
              // keep local-only assets (with object URLs)
              for (const rest of byId.values()) merged.push(rest);
              setAssets(merged);
            }
          } catch {}
          return;
        } catch (e) {
          // fall back to local storage
        }
      }
      const loadedSchedule = loadSchedule();
      if (loadedSchedule) setSchedule(loadedSchedule);
    })();
    const loadedCats = loadCategories();
    if (loadedCats.length) setCategories(loadedCats);
  }, []);

  // Persist on changes (small state; immediate save is fine)
  useEffect(() => { saveAssets(assets); }, [assets]);
  useEffect(() => { saveSchedule(schedule); }, [schedule]);
  useEffect(() => { saveCategories(categories); }, [categories]);

  // Backfill durations from S3 (presigned) for unknown assets
  useDurationBackfill(assets, setAssets);

  // Cleanup: clear all pending save timers on unmount
  useEffect(() => {
    return () => {
      DAYS.forEach(day => {
        if (saveTimersRef.current[day]) {
          clearTimeout(saveTimersRef.current[day]!);
        }
      });
    };
  }, []);

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
    // categories realtime
    const unsubCats = client.subscribe('categories', (evt) => {
      if (evt.event === 'created' && evt.category) setCategories((prev) => prev.concat(evt.category));
      if (evt.event === 'updated' && evt.category) setCategories((prev) => prev.map(c => c.id === evt.category.id ? evt.category : c));
      if (evt.event === 'deleted' && evt.id) setCategories((prev) => prev.filter(c => c.id !== evt.id));
    });
    return () => { unsubs.forEach((u) => u()); client.disconnect(); };
  }, []);

  const saveDayToBackend = (day: Day, items: ScheduledItem[]) => {
    if (!CONFIG.USE_BACKEND_SCHEDULE || !CONFIG.API_BASE_URL) return;

    // Clear existing timer for this day
    if (saveTimersRef.current[day]) {
      clearTimeout(saveTimersRef.current[day]!);
    }

    // Debounce the save by 500ms
    saveTimersRef.current[day] = setTimeout(async () => {
      try {
        const meta = playback[day];
        const doc = await putDaySchedule({ channel: CONFIG.CHANNEL, week: CONFIG.WEEK, day, items, version: versions[day] || 0, playbackMode: meta?.mode, playStart: meta?.start });
        setVersions(prev => ({ ...prev, [day]: doc.version }));
      } catch {
        try {
          const latest = await getDaySchedule({ channel: CONFIG.CHANNEL, week: CONFIG.WEEK, day });
          setSchedule(prev => ({ ...prev, [day]: latest.items }));
          setVersions(prev => ({ ...prev, [day]: latest.version }));
          if (latest.playbackMode) setPlayback(prev => ({ ...prev, [day]: { mode: latest.playbackMode!, start: latest.playStart } }));
        } catch {}
      }
    }, 500);
  };

  const handleDeleteFromSchedule = (day: Day, itemId: string) => {
    const updatedItems = schedule[day].filter(item => item.id !== itemId);
    setSchedule(prev => ({ ...prev, [day]: updatedItems }));
    saveDayToBackend(day, updatedItems);
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
      {/* Status Badge for outages */}
      <StatusBadge />

      {/* Status Boxes under header */}
      <div className="status-boxes-container">
      <StreamerControls assetMap={assetMap} schedule={schedule} />
      </div>

      {/* Preview Panel Container - HLS Player, Volume Visualizer, Asset Preview, and System Status */}
      <div className="preview-panel-container">
        {CONFIG.RELAY_BASE_URL && (
          <HlsPlayer onVideoReady={(video) => setLivestreamVideo(video)} />
        )}
        {CONFIG.RELAY_BASE_URL && <VolumeVisualizer audioElement={livestreamVideo} />}
        <PreviewPane
          asset={selectedAssetId ? (assetMap.get(selectedAssetId) || null) : null}
          onClose={() => setSelectedAssetId(null)}
          categories={categories}
        />
        <SystemStatus />
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="content-layout">
          {/* Library - full width */}
          <LibraryPanel
            assets={assets}
            categories={categories}
            setAssets={setAssets}
            onAssetUploaded={handleAssetUploaded}
          />

          {/* Schedule Grid - full width */}
          <div className="schedule-grid" style={{ position: 'relative' }}>
              {DAYS.map((day) => (
                <Droppable droppableId={day} key={day}>
                  {(provided) => (
                    <DayColumn
                      day={day}
                      items={schedule[day]}
                      provided={provided}
                      assetMap={assetMap}
                      categories={categories}
                      onSelect={(id) => setSelectedAssetId(id)}
                      onDelete={(itemId) => handleDeleteFromSchedule(day, itemId)}
                      playbackMode={playback[day]?.mode}
                      playStart={playback[day]?.start}
                      onPlaybackChange={(mode, start) => {
                        setPlayback(prev => ({ ...prev, [day]: { mode, start } }));
                        saveDayToBackend(day, schedule[day]);
                      }}
                    />
                  )}
                </Droppable>
              ))}
          </div>

          {/* Categories panel - full width below schedule */}
          <CategoriesPanel categories={categories} onChange={setCategories} apiEnabled={!!CONFIG.API_BASE_URL} />
        </div>
      </DragDropContext>
    </div>
  );
}
