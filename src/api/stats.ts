import { CONFIG } from '../config';

/** Separate from the Broadcaster's `token` key: the shared stats password opens /stats only. */
const TOKEN_KEY = 'ralphTV.stats.token';

export type Surface = 'tv' | 'home' | 'embed' | 'all';

export interface Kpis {
  visits: number;
  viewers: number;
  bounced: number;
  watch_sec: number;
  median_viewer_sec: number;
  desktop_played: number;
  desktop_unmuted: number;
  mobile_visits: number;
  mobile_tapped: number;
  gated: number;
  gated_on_arrival: number;
  subscribe_clicks: number;
  offline_visits: number;
}
export interface FunnelRow { device: string; arrived: number; started: number; s10: number; s30: number; s120: number; s600: number }
export interface DailyRow { day: string; visits: number; viewers: number; watch_sec: number }
export interface HourRow { hour: number; watch_sec: number; viewers: number }
export interface SourceRow { source: string; campaign: string | null; visits: number; viewers: number; watch_sec: number }
export interface DeviceRow { device: string; browser: string; visits: number; viewers: number; watch_sec: number }
export interface ActionRow { event: string; kind: string; events: number; sessions: number }

export interface Overview {
  from: string;
  to: string;
  surface: Surface;
  tz: string;
  kpis: Kpis;
  funnel: FunnelRow[];
  daily: DailyRow[];
  hours: HourRow[];
  sources: SourceRow[];
  devices: DeviceRow[];
  actions: ActionRow[];
}

export interface ShowRow {
  asset_id: string;
  name: string;
  duration_sec: number | null;
  category: string | null;
  category_color: string | null;
  viewers: number;
  watch_sec: number;
  exits: number;
  median_exit_sec: number | null;
  curve: { b: number; n: number }[];
}

export interface LiveNow {
  total: number;
  windowSec: number;
  rows: { surface: string; device: string; asset_id: string | null; name: string | null; n: number }[];
}

export class StatsAuthError extends Error {}

export function getStatsToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function clearStatsToken(): void {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
}

/** Exchange the shared password for a stats token. Throws with a readable message. */
export async function statsLogin(password: string): Promise<void> {
  const res = await fetch(`${CONFIG.API_BASE_URL}/analytics/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) throw new Error(body.message || `Login failed (${res.status})`);
  try { localStorage.setItem(TOKEN_KEY, body.token); } catch { /* still works for this page load */ }
  memoryToken = body.token;
}

let memoryToken: string | null = null;

async function get<T>(path: string): Promise<T> {
  const token = memoryToken || getStatsToken();
  if (!token) throw new StatsAuthError('Login required');
  const res = await fetch(`${CONFIG.API_BASE_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403) {
    clearStatsToken();
    memoryToken = null;
    throw new StatsAuthError('Login expired');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function qs(from: string, to: string, surface: Surface): string {
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&surface=${surface}`;
}

export const fetchOverview = (from: string, to: string, surface: Surface) =>
  get<Overview>(`/analytics/overview?${qs(from, to, surface)}`);

export const fetchShows = (from: string, to: string, surface: Surface) =>
  get<{ shows: ShowRow[] }>(`/analytics/shows?${qs(from, to, surface)}`).then((r) => r.shows);

export const fetchLive = () => get<LiveNow>('/analytics/live');
