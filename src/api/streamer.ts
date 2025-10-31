import { CONFIG } from '../config';

const base = () => (import.meta.env.VITE_STREAMER_BASE_URL || '').replace(/\/$/, '');

export async function streamerStatus() {
  const url = `${base()}/status`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`streamer status failed: ${res.status}`);
  return res.json();
}

export async function streamerStart() {
  const res = await fetch(`${base()}/control/start`, { method: 'POST' });
  if (!res.ok) throw new Error(`streamer start failed: ${res.status}`);
  return res.json();
}

export async function streamerStop() {
  const res = await fetch(`${base()}/control/stop`, { method: 'POST' });
  if (!res.ok) throw new Error(`streamer stop failed: ${res.status}`);
  return res.json();
}

