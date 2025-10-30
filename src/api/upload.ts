import { CONFIG } from '../config';

export type InitUploadResponse =
  | { kind: 'single'; fileId: string; s3Key: string; url: string; headers?: Record<string,string>; expiresAt: string }
  | { kind: 'multipart'; fileId: string; s3Key: string; uploadId: string; partUrls?: { partNumber: number; url: string }[]; parts?: number };

export async function initUpload(params: { fileName: string; mimeType: string; size: number; tags?: string[] }): Promise<InitUploadResponse> {
  if (CONFIG.USE_MOCK_UPLOADS) {
    // Mocked: always return single upload URL
    const fileId = crypto.randomUUID?.() ?? `f_${Date.now()}`;
    return {
      kind: 'single',
      fileId,
      s3Key: `raw/mock/${fileId}/${params.fileName}`,
      url: `https://example.invalid/mock-upload/${fileId}`,
      headers: { 'Content-Type': params.mimeType },
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
  }
  // Real call (placeholder)
  const token = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || CONFIG.API_AUTH_TOKEN;
  const res = await fetch(`${CONFIG.API_BASE_URL}/uploads/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`initUpload failed: ${res.status}`);
  return res.json();
}

export async function putSingle(url: string, file: File, headers?: Record<string,string>, onProgress?: (pct: number) => void): Promise<void> {
  if (CONFIG.USE_MOCK_UPLOADS) {
    // Simulate progress
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await new Promise(r => setTimeout(r, 60));
      onProgress?.(Math.round((i / steps) * 100));
    }
    return;
  }
  // Native fetch lacks progress; use XHR for progress if needed
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    if (headers) for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`PUT failed ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('PUT network error'));
    xhr.send(file);
  });
}

export async function completeUpload(params: { fileId: string; uploadId?: string; parts?: { partNumber: number; etag: string }[]; s3Key?: string; fileName?: string; mimeType?: string; size?: number; durationSec?: number }) {
  if (CONFIG.USE_MOCK_UPLOADS) {
    return { ok: true };
  }
  const token = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || CONFIG.API_AUTH_TOKEN;
  const res = await fetch(`${CONFIG.API_BASE_URL}/uploads/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`completeUpload failed: ${res.status}`);
  return res.json();
}

type PartMeta = { partNumber: number; etag: string };

async function putPart(url: string, blob: Blob, onProgress?: (loaded: number) => void): Promise<string> {
  if (CONFIG.USE_MOCK_UPLOADS) {
    // Simulate part upload
    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      await new Promise(r => setTimeout(r, 50));
      onProgress?.((blob.size / steps) * i);
    }
    return `"mock-etag-${Math.random().toString(36).slice(2)}"`;
  }
  return await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag') || '';
        resolve(etag);
      } else {
        reject(new Error(`Part PUT failed ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Part PUT network error'));
    xhr.send(blob);
  });
}

export async function uploadMultipart(file: File, partUrls: { partNumber: number; url: string }[], onProgress?: (pct: number) => void): Promise<PartMeta[]> {
  const total = file.size;
  let uploaded = 0;
  const parts: PartMeta[] = [];

  // Assume one URL per part, in ascending order
  for (let i = 0; i < partUrls.length; i++) {
    const { partNumber, url } = partUrls[i];
    // Compute slice boundaries by even division
    const start = Math.floor((i / partUrls.length) * total);
    const end = i === partUrls.length - 1 ? total : Math.floor(((i + 1) / partUrls.length) * total);
    const blob = file.slice(start, end);
    const etag = await putPart(url, blob, (inc) => {
      // inc is loaded within this part; approximate aggregate
      const base = Math.floor((i / partUrls.length) * total);
      const current = Math.min(base + inc, end);
      const gross = (start + inc) - start; // bytes within this part
      const tentativeUploaded = Math.min(uploaded + (gross - 0), total);
      const pct = Math.max(0, Math.min(100, Math.round(((uploaded + gross) / total) * 100)));
      onProgress?.(pct);
    });
    uploaded += blob.size;
    parts.push({ partNumber, etag });
    onProgress?.(Math.round((uploaded / total) * 100));
  }
  return parts;
}

export async function getPartUrl(uploadId: string, s3Key: string, partNumber: number): Promise<string> {
  if (CONFIG.USE_MOCK_UPLOADS) return `https://example.invalid/mock-part/${partNumber}`;
  const token = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || CONFIG.API_AUTH_TOKEN;
  const url = new URL(`${CONFIG.API_BASE_URL}/uploads/part-url`);
  url.searchParams.set('uploadId', uploadId);
  url.searchParams.set('key', s3Key);
  url.searchParams.set('partNumber', String(partNumber));
  const res = await fetch(url.toString(), { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!res.ok) throw new Error(`part-url failed: ${res.status}`);
  const data = await res.json();
  return data.url as string;
}

export async function uploadMultipartWithSigner(
  file: File,
  partsCount: number,
  signer: (partNumber: number) => Promise<string>,
  onProgress?: (pct: number) => void
): Promise<PartMeta[]> {
  const total = file.size;
  let uploaded = 0;
  const parts: PartMeta[] = [];
  for (let i = 0; i < partsCount; i++) {
    const partNumber = i + 1;
    const start = Math.floor((i / partsCount) * total);
    const end = i === partsCount - 1 ? total : Math.floor(((i + 1) / partsCount) * total);
    const blob = file.slice(start, end);
    const url = await signer(partNumber);
    const etag = await putPart(url, blob, (inc) => {
      const pct = Math.max(0, Math.min(100, Math.round(((uploaded + inc) / total) * 100)));
      onProgress?.(pct);
    });
    uploaded += blob.size;
    parts.push({ partNumber, etag });
    onProgress?.(Math.round((uploaded / total) * 100));
  }
  return parts;
}
