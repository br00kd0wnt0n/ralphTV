import type { Asset, Day, ScheduledItem } from './models';

const ASSETS_KEY = 'ralphTV.assets.v1';
const SCHEDULE_KEY = 'ralphTV.schedule.v1';

type PersistedAsset = Omit<Asset, 'url'>;

export function saveAssets(assets: Asset[]) {
  try {
    const minimal: PersistedAsset[] = assets.map(({ url, ...rest }) => rest);
    localStorage.setItem(ASSETS_KEY, JSON.stringify(minimal));
  } catch {}
}

export function loadAssets(): Asset[] {
  try {
    const raw = localStorage.getItem(ASSETS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as PersistedAsset[];
    return arr.map(a => ({ ...a, url: '' }));
  } catch {
    return [];
  }
}

export function saveSchedule(schedule: Record<Day, ScheduledItem[]>) {
  try {
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedule));
  } catch {}
}

export function loadSchedule(): Record<Day, ScheduledItem[]> | null {
  try {
    const raw = localStorage.getItem(SCHEDULE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Record<Day, ScheduledItem[]>;
  } catch {
    return null;
  }
}

