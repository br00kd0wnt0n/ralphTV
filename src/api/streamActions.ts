import { CONFIG } from '../config';

function authHeaders(): Record<string, string> {
  const token = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || CONFIG.API_AUTH_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function logStreamAction(action: 'start' | 'stop' | 'restart') {
  const res = await fetch(`${CONFIG.API_BASE_URL}/stream-actions/log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(`logStreamAction failed: ${res.status}`);
  return res.json();
}

export async function getLastStreamAction() {
  const res = await fetch(`${CONFIG.API_BASE_URL}/stream-actions/last`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`getLastStreamAction failed: ${res.status}`);
  return res.json();
}
