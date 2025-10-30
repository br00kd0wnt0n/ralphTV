import React, { useMemo, useState } from 'react';
import { initUpload, putSingle, completeUpload, uploadMultipart, uploadMultipartWithSigner, getPartUrl } from '../api/upload';
import type { Asset } from '../state/models';

type UploadItem = {
  id: string;
  name: string;
  progress: number;
  status: 'idle'|'uploading'|'done'|'error';
  error?: string;
};

function detectType(mime: string): Asset['type'] {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'unknown';
}

export default function UploadBar({ onAssetUploaded }: { onAssetUploaded: (asset: Asset) => void }) {
  const [items, setItems] = useState<UploadItem[]>([]);

  const handleFiles: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    e.currentTarget.value = '';

    for (const file of files) {
      const tempId = crypto.randomUUID?.() ?? `u_${Date.now()}_${Math.random()}`;
      setItems(prev => [...prev, { id: tempId, name: file.name, progress: 0, status: 'idle' }]);
      try {
        const init = await initUpload({ fileName: file.name, mimeType: file.type, size: file.size });
        setItems(prev => prev.map(it => it.id === tempId ? { ...it, status: 'uploading' } : it));
        if (init.kind === 'single') {
          await putSingle(init.url, file, init.headers, (pct) => {
            setItems(prev => prev.map(it => it.id === tempId ? { ...it, progress: pct } : it));
          });
          await completeUpload({ fileId: init.fileId, s3Key: init.s3Key, fileName: file.name, mimeType: file.type, size: file.size });
          const objectUrl = URL.createObjectURL(file);
          const asset: Asset = {
            id: init.fileId,
            fileId: init.fileId,
            name: file.name,
            type: detectType(file.type),
            url: objectUrl,
            mimeType: file.type,
            size: file.size,
            s3Key: init.s3Key,
            uploadedAt: new Date().toISOString(),
            tags: [],
          };
          onAssetUploaded(asset);
          setItems(prev => prev.map(it => it.id === tempId ? { ...it, progress: 100, status: 'done' } : it));
        } else {
          let partsMeta;
          if (init.partUrls && init.partUrls.length) {
            partsMeta = await uploadMultipart(file, init.partUrls, (pct) => {
              setItems(prev => prev.map(it => it.id === tempId ? { ...it, progress: pct } : it));
            });
          } else if (init.uploadId && init.s3Key && (init.parts || 0) > 0) {
            const count = init.parts!;
            partsMeta = await uploadMultipartWithSigner(
              file,
              count,
              (pn) => getPartUrl(init.uploadId!, init.s3Key!, pn),
              (pct) => setItems(prev => prev.map(it => it.id === tempId ? { ...it, progress: pct } : it))
            );
          } else {
            throw new Error('Multipart not properly configured by backend');
          }
          await completeUpload({ fileId: init.fileId, uploadId: init.uploadId, parts: partsMeta, s3Key: init.s3Key, fileName: file.name, mimeType: file.type, size: file.size });
          const objectUrl = URL.createObjectURL(file);
          const asset: Asset = {
            id: init.fileId,
            fileId: init.fileId,
            name: file.name,
            type: detectType(file.type),
            url: objectUrl,
            mimeType: file.type,
            size: file.size,
            s3Key: init.s3Key,
            uploadedAt: new Date().toISOString(),
            tags: [],
          };
          onAssetUploaded(asset);
          setItems(prev => prev.map(it => it.id === tempId ? { ...it, progress: 100, status: 'done' } : it));
        }
      } catch (err: any) {
        setItems(prev => prev.map(it => it.id === tempId ? { ...it, status: 'error', error: String(err?.message || err) } : it));
      }
    }
  };

  const active = useMemo(() => items.filter(i => i.status !== 'done'), [items]);

  return (
    <div className="upload-section">
      <input type="file" accept="video/*,audio/*" multiple onChange={handleFiles} />
      {active.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {active.map(it => (
            <div key={it.id} style={{ fontSize: 12, marginBottom: 6 }}>
              <div>{it.name} — {it.status} {it.status === 'uploading' ? `${it.progress}%` : ''}</div>
              {it.status === 'uploading' && (
                <div style={{ background: '#eee', height: 6, borderRadius: 3 }}>
                  <div style={{ width: `${it.progress}%`, background: '#4CAF50', height: 6, borderRadius: 3 }} />
                </div>
              )}
              {it.status === 'error' && (
                <div style={{ color: '#d32f2f' }}>{it.error}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
