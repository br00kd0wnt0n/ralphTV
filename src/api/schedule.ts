import { CONFIG } from '../config';
import type { Day, ScheduledItem } from '../state/models';

export type ScheduleDoc = { day: Day; version: number; timezone?: string; items: ScheduledItem[]; playbackMode?: 'loop'|'playthru'; playStart?: string };

function authHeaders(): Record<string, string> {
  const token = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || CONFIG.API_AUTH_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getDaySchedule(params: { channel: string; week: string; day: Day }): Promise<ScheduleDoc> {
  const { channel, week, day } = params;
  const res = await fetch(`${CONFIG.API_BASE_URL}/schedule/${encodeURIComponent(channel)}/${encodeURIComponent(week)}/${day}`, {
    headers: { 'Accept': 'application/json', ...authHeaders() },
  });
  if (!res.ok) throw new Error(`getDaySchedule ${day} failed: ${res.status}`);
  const doc = await res.json();
  // Expect { version, items, timezone? }
  return { day, version: doc.version ?? 0, timezone: doc.timezone, items: doc.items ?? [] , playbackMode: doc.playbackMode, playStart: doc.playStart };
}

export async function putDaySchedule(params: { channel: string; week: string; day: Day; items: ScheduledItem[]; version: number; playbackMode?: 'loop'|'playthru'; playStart?: string }): Promise<ScheduleDoc> {
  const { channel, week, day, items, version, playbackMode, playStart } = params;
  const res = await fetch(`${CONFIG.API_BASE_URL}/schedule/${encodeURIComponent(channel)}/${encodeURIComponent(week)}/${day}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'If-Match': String(version),
      ...authHeaders(),
    },
    body: JSON.stringify({ items, playbackMode, playStart }),
  });
  if (res.status === 409) {
    const latest = await res.json().catch(() => null);
    const doc = latest?.doc ?? latest ?? null;
    if (doc) return { day, version: doc.version ?? version, timezone: doc.timezone, items: doc.items ?? [] };
    throw new Error('Conflict');
  }
  if (!res.ok) throw new Error(`putDaySchedule ${day} failed: ${res.status}`);
  const doc = await res.json();
  return { day, version: doc.version ?? version + 1, timezone: doc.timezone, items: doc.items ?? items, playbackMode: doc.playbackMode, playStart: doc.playStart };
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
  const res = await fetch(`${CONFIG.API_BASE_URL}/schedule/${encodeURIComponent(channel)}/${encodeURIComponent(week)}/${day}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'If-Match': String(version),
      ...authHeaders(),
    },
    body: JSON.stringify({ ops }),
  });
  if (res.status === 409) {
    const latest = await res.json().catch(() => null);
    const doc = latest?.doc ?? latest ?? null;
    if (doc) return { day, version: doc.version ?? version, timezone: doc.timezone, items: doc.items ?? [] };
    throw new Error('Conflict');
  }
  if (!res.ok) throw new Error(`patchDaySchedule ${day} failed: ${res.status}`);
  const doc = await res.json();
  return { day, version: doc.version ?? version + 1, timezone: doc.timezone, items: doc.items ?? [] };
}
