import { CONFIG } from '../config';

const headers = () => {
  const token = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || CONFIG.API_AUTH_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export async function getStatusToday(channel: string, week: string) {
  const res = await fetch(`${CONFIG.API_BASE_URL}/status/${encodeURIComponent(channel)}/${encodeURIComponent(week)}/today`, { headers: headers() });
  if (!res.ok) throw new Error(`status today failed: ${res.status}`);
  return res.json();
}

