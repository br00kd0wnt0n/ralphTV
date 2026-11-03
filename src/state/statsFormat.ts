// Pure helpers for the /stats page: date ranges, number and duration formatting.

export type RangeKey = 'today' | '7d' | '30d' | '90d';

export const RANGES: { key: RangeKey; label: string; days: number }[] = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
];

/** YYYY-MM-DD for a date in London (the channel's timezone). */
export function londonDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/** Inclusive from/to for a range ending today (London). */
export function rangeDates(key: RangeKey, now = new Date()): { from: string; to: string } {
  const days = RANGES.find((r) => r.key === key)?.days ?? 7;
  const to = londonDate(now);
  const d = new Date(`${to}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return { from: d.toISOString().slice(0, 10), to };
}

/** Every date from..to inclusive, so the daily chart shows empty days as zero. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** "3 Nov" from YYYY-MM-DD. */
export function shortDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Seconds -> "45s", "3m 20s", "2h 05m". */
export function duration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '–';
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m}m ${r}s` : `${m}m`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Watch time as hours with one decimal once it's over an hour, else a duration. */
export function watchTotal(sec: number): string {
  return sec >= 3600 ? `${(sec / 3600).toFixed(1)}h` : duration(sec);
}

/** Share as a whole-number percent, or "–" when the base is empty. */
export function pct(n: number, of: number): string {
  if (!of) return '–';
  return `${Math.round((n / of) * 100)}%`;
}

export function compact(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/** Clean axis maximum: 1, 2, 5 × 10^k at or above `v`. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Human labels for player events on the "What people do" list. */
export const ACTION_LABELS: Record<string, string> = {
  play_start: 'Picture started',
  tap_to_watch: 'Tapped "Tap to watch" (mobile)',
  unmute: 'Turned the sound on',
  mute: 'Muted',
  'overlay_open:info': 'Opened Show info',
  'overlay_open:schedule': 'Opened Schedule',
  fullscreen_enter: 'Went fullscreen (desktop)',
  immersive_exit: 'Closed the mobile player',
  show_change: 'Stayed into the next clip',
  gate_shown: 'Hit the subscribe gate',
  subscribe_click: 'Clicked subscribe',
  offline_view: 'Arrived while off air',
  stall: 'Video stalled',
  error: 'Player error',
  vod_play: 'Played a show on demand',
  back_to_live: 'Pressed "Back to live"',
  share: 'Shared',
};

export function actionLabel(event: string, kind: string): string {
  return ACTION_LABELS[`${event}:${kind}`] || ACTION_LABELS[event] || (kind ? `${event} (${kind})` : event);
}

export const DEVICE_ORDER = ['desktop', 'mobile', 'tablet'] as const;
