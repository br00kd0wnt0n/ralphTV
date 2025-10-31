import { CONFIG } from '../config';

const headers = () => {
  const token = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || CONFIG.API_AUTH_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

function dayName(d = new Date()): string {
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
}

export async function getScheduleDebugToday(channel: string, week: string) {
  const day = dayName();
  const res = await fetch(`${CONFIG.API_BASE_URL}/debug/schedule/${encodeURIComponent(channel)}/${encodeURIComponent(week)}/${day}`, { headers: headers() });
  if (!res.ok) throw new Error(`debug schedule failed: ${res.status}`);
  return res.json();
}

