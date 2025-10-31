import { CONFIG } from '../config';

function dayName(d = new Date()): string {
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
}

const headers = () => {
  const token = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || CONFIG.API_AUTH_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export async function getPlaylistToday(channel: string, week: string) {
  const day = dayName();
  const res = await fetch(`${CONFIG.API_BASE_URL}/feed/${encodeURIComponent(channel)}/${encodeURIComponent(week)}/${day}/playlist`, { headers: headers() });
  if (!res.ok) throw new Error(`playlist failed: ${res.status}`);
  return res.json();
}

