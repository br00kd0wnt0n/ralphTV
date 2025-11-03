import { CONFIG } from '../config';

const base = () => (CONFIG.RELAY_BASE_URL || '').replace(/\/$/, '');

export async function getRelayDestinations() {
  if (!base()) return { destinations: [] };
  try {
    const url = `${base()}/api/destinations`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`relay destinations failed: ${res.status}`);
    return res.json();
  } catch (e) {
    console.warn('Failed to fetch relay destinations:', e);
    return { destinations: [] };
  }
}

export async function getRelayStatus() {
  if (!base()) return { streaming: false };
  try {
    const url = `${base()}/api/status`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`relay status failed: ${res.status}`);
    return res.json();
  } catch (e) {
    console.warn('Failed to fetch relay status:', e);
    return { streaming: false };
  }
}
