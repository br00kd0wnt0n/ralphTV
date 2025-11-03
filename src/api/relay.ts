import { CONFIG } from '../config';

// Use backend proxy to avoid CORS issues
const backendBase = () => (CONFIG.API_BASE_URL || '').replace(/\/$/, '');

export async function getRelayDestinations() {
  if (!backendBase()) return { destinations: [] };
  try {
    const url = `${backendBase()}/api/relay/destinations`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`relay destinations failed: ${res.status}`);
    return res.json();
  } catch (e) {
    console.warn('Failed to fetch relay destinations:', e);
    return { destinations: [] };
  }
}

export async function getRelayStatus() {
  if (!backendBase()) return { streaming: false, available: false };
  try {
    const url = `${backendBase()}/api/relay/status`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`relay status failed: ${res.status}`);
    return res.json();
  } catch (e) {
    console.warn('Failed to fetch relay status:', e);
    return { streaming: false, available: false };
  }
}

export async function checkRelayHealth() {
  if (!backendBase()) return { available: false, error: 'No backend configured' };
  try {
    const url = `${backendBase()}/api/relay/healthz`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`relay health check failed: ${res.status}`);
    return res.json();
  } catch (e) {
    console.warn('Failed to check relay health:', e);
    return { available: false, error: String(e) };
  }
}
