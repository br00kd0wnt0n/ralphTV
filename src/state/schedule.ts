import type { Day } from './models';

export const reorder = <T,>(list: T[], startIndex: number, endIndex: number): T[] => {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
};

export const makeId = () => (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const isDay = (id: string): id is Day => (
  ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'] as const
).includes(id as Day);

export function formatDuration(totalSec: number): string {
  if (!isFinite(totalSec) || totalSec <= 0) return '0s';
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function durationToHeightPx(durationSec?: number): number {
  // Map 0..1800s to 24..160px using sqrt for diminishing returns
  const MIN = 24;
  const MAX = 160;
  if (!durationSec || durationSec <= 0) return 40;
  const t = Math.max(0, Math.min(1, durationSec / 1800));
  const eased = Math.sqrt(t);
  return Math.round(MIN + (MAX - MIN) * eased);
}
