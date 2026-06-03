import { CONFIG } from '../config';
import { apiFetch } from './client';

// Control + status now go through the authenticated backend proxy
// (/streamer/*). The streamer's control token lives server-side on the backend,
// so it never ships in the browser bundle. apiFetch attaches the admin JWT.
const api = (path: string) => `${CONFIG.API_BASE_URL}${path}`;

async function post(path: string) {
  const res = await apiFetch(api(path), { method: 'POST' });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

export async function streamerStatus() {
  const res = await apiFetch(api('/streamer/status'));
  if (!res.ok) throw new Error(`streamer status failed: ${res.status}`);
  return res.json();
}

export async function streamerStart() {
  return post('/streamer/control/start');
}

export async function streamerStop() {
  return post('/streamer/control/stop');
}

export async function streamerRestart() {
  return post('/streamer/control/restart');
}

export async function streamerTestSignal(seconds = 30) {
  return post(`/streamer/control/test-signal?seconds=${encodeURIComponent(String(seconds))}`);
}
