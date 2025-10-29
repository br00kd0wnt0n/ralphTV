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

