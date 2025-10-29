import { CONFIG } from '../config';

function authHeaders(): Record<string, string> {
  const token = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || CONFIG.API_AUTH_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function updateAssetTags(params: { assetId: string; tags: string[] }) {
  const res = await fetch(`${CONFIG.API_BASE_URL}/assets/${encodeURIComponent(params.assetId)}/tags`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ tags: params.tags }),
  });
  if (!res.ok) throw new Error(`updateAssetTags failed: ${res.status}`);
  return res.json().catch(() => ({}));
}
