import { CONFIG } from '../config';
import type { Day, ScheduledItem } from '../state/models';
import { apiGet, apiPut, apiPatch } from './client';

export type ScheduleDoc = { day: Day; version: number; timezone?: string; items: ScheduledItem[]; playbackMode?: 'loop'|'playthru'; playStart?: string };

export async function getDaySchedule(params: { channel: string; week: string; day: Day }): Promise<ScheduleDoc> {
  const { channel, week, day } = params;
  const doc = await apiGet<any>(`${CONFIG.API_BASE_URL}/schedule/${encodeURIComponent(channel)}/${encodeURIComponent(week)}/${day}`);
  // Expect { version, items, timezone? }
  return { day, version: doc.version ?? 0, timezone: doc.timezone, items: doc.items ?? [] , playbackMode: doc.playbackMode, playStart: doc.playStart };
}

export async function putDaySchedule(params: { channel: string; week: string; day: Day; items: ScheduledItem[]; version: number; playbackMode?: 'loop'|'playthru'; playStart?: string }): Promise<ScheduleDoc> {
  const { channel, week, day, items, version, playbackMode, playStart } = params;
  try {
    const doc = await apiPut<any>(
      `${CONFIG.API_BASE_URL}/schedule/${encodeURIComponent(channel)}/${encodeURIComponent(week)}/${day}`,
      { items, playbackMode, playStart },
      { 'If-Match': String(version) }
    );
    return { day, version: doc.version ?? version + 1, timezone: doc.timezone, items: doc.items ?? items, playbackMode: doc.playbackMode, playStart: doc.playStart };
  } catch (error) {
    // Note: apiPut will handle 401, but we still need to handle 409 conflicts
    // For now, re-throw as the calling code should refetch
    throw error;
  }
}

export async function patchDaySchedule(params: {
  channel: string;
  week: string;
  day: Day;
  ops: Array<
    | { type: 'add'; index: number; item: ScheduledItem }
    | { type: 'move'; fromIndex: number; toIndex: number }
    | { type: 'remove'; index: number }
  >;
  version: number;
}): Promise<ScheduleDoc> {
  const { channel, week, day, ops, version } = params;
  try {
    const doc = await apiPatch<any>(
      `${CONFIG.API_BASE_URL}/schedule/${encodeURIComponent(channel)}/${encodeURIComponent(week)}/${day}`,
      { ops },
      { 'If-Match': String(version) }
    );
    return { day, version: doc.version ?? version + 1, timezone: doc.timezone, items: doc.items ?? [] };
  } catch (error) {
    // Note: apiPatch will handle 401, but we still need to handle 409 conflicts
    // For now, re-throw as the calling code should refetch
    throw error;
  }
}
