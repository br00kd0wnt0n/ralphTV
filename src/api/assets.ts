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

export async function listAssets() {
  const res = await fetch(`${CONFIG.API_BASE_URL}/assets`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`listAssets failed: ${res.status}`);
  return res.json();
}

export async function setAssetCategory(params: { assetId: string; categoryId?: string }) {
  const res = await fetch(`${CONFIG.API_BASE_URL}/assets/${encodeURIComponent(params.assetId)}/category`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ categoryId: params.categoryId || null }),
  });
  if (!res.ok) throw new Error(`setAssetCategory failed: ${res.status}`);
  return res.json();
}

export async function listCategories() {
  const res = await fetch(`${CONFIG.API_BASE_URL}/categories`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`listCategories failed: ${res.status}`);
  return res.json();
}

export async function createCategory(params: { name: string; color: string }) {
  const res = await fetch(`${CONFIG.API_BASE_URL}/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`createCategory failed: ${res.status}`);
  return res.json();
}

export async function updateCategory(id: string, patch: { name?: string; color?: string }) {
  const res = await fetch(`${CONFIG.API_BASE_URL}/categories/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`updateCategory failed: ${res.status}`);
  return res.json();
}

export async function deleteCategory(id: string) {
  const res = await fetch(`${CONFIG.API_BASE_URL}/categories/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) throw new Error(`deleteCategory failed: ${res.status}`);
  return res.json();
}

export async function getAssetReadUrl(assetId: string) {
  const res = await fetch(`${CONFIG.API_BASE_URL}/assets/${encodeURIComponent(assetId)}/url`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`getAssetReadUrl failed: ${res.status}`);
  return res.json();
}

export async function setAssetDuration(assetId: string, durationSec: number) {
  const res = await fetch(`${CONFIG.API_BASE_URL}/assets/${encodeURIComponent(assetId)}/duration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ durationSec }),
  });
  if (!res.ok) throw new Error(`setAssetDuration failed: ${res.status}`);
  return res.json();
}
