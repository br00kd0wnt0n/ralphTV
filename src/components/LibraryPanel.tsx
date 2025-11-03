import React, { useRef, useState, useMemo } from 'react';
import { Droppable } from 'react-beautiful-dnd';
import type { Asset, Category } from '../state/models';
import LibraryList from './LibraryList';
import { updateAssetTags, setAssetCategory, updateAssetName } from '../api/assets';
import { CONFIG } from '../config';
import { initUpload, putSingle, completeUpload, uploadMultipart, uploadMultipartWithSigner, getPartUrl } from '../api/upload';
import { probeDuration } from '../utils/media';

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

export default function LibraryPanel({
  assets,
  categories,
  setAssets,
  onAssetUploaded,
}: {
  assets: Asset[];
  categories: Category[];
  setAssets: (updater: (prev: Asset[]) => Asset[]) => void;
  onAssetUploaded: (asset: Asset) => void;
}) {
  const apiEnabled = !!CONFIG.API_BASE_URL;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const handleFiles: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    e.currentTarget.value = '';

    for (const file of files) {
      const tempId = crypto.randomUUID?.() ?? `u_${Date.now()}_${Math.random()}`;
      setUploadItems(prev => [...prev, { id: tempId, name: file.name, progress: 0, status: 'idle' }]);
      try {
        const init = await initUpload({ fileName: file.name, mimeType: file.type, size: file.size });
        setUploadItems(prev => prev.map(it => it.id === tempId ? { ...it, status: 'uploading' } : it));
        if (init.kind === 'single') {
          await putSingle(init.url, file, init.headers, (pct) => {
            setUploadItems(prev => prev.map(it => it.id === tempId ? { ...it, progress: pct } : it));
          });
          const objectUrl = URL.createObjectURL(file);
          const duration = await probeDuration(objectUrl, detectType(file.type));
          await completeUpload({ fileId: init.fileId, s3Key: init.s3Key, fileName: file.name, mimeType: file.type, size: file.size, ...(duration ? { durationSec: duration } : {}) });
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
            ...(duration ? { durationSec: duration } : {}),
          };
          onAssetUploaded(asset);
          setUploadItems(prev => prev.map(it => it.id === tempId ? { ...it, progress: 100, status: 'done' } : it));
        } else {
          let partsMeta;
          if (init.partUrls && init.partUrls.length) {
            partsMeta = await uploadMultipart(file, init.partUrls, (pct) => {
              setUploadItems(prev => prev.map(it => it.id === tempId ? { ...it, progress: pct } : it));
            });
          } else if (init.uploadId && init.s3Key && (init.parts || 0) > 0) {
            const count = init.parts!;
            partsMeta = await uploadMultipartWithSigner(
              file,
              count,
              (pn) => getPartUrl(init.uploadId!, init.s3Key!, pn),
              (pct) => setUploadItems(prev => prev.map(it => it.id === tempId ? { ...it, progress: pct } : it))
            );
          } else {
            throw new Error('Multipart not properly configured by backend');
          }
          const objectUrl = URL.createObjectURL(file);
          const duration = await probeDuration(objectUrl, detectType(file.type));
          await completeUpload({ fileId: init.fileId, uploadId: init.uploadId, parts: partsMeta, s3Key: init.s3Key, fileName: file.name, mimeType: file.type, size: file.size, ...(duration ? { durationSec: duration } : {}) });
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
            ...(duration ? { durationSec: duration } : {}),
          };
          onAssetUploaded(asset);
          setUploadItems(prev => prev.map(it => it.id === tempId ? { ...it, progress: 100, status: 'done' } : it));
        }
      } catch (err: any) {
        setUploadItems(prev => prev.map(it => it.id === tempId ? { ...it, status: 'error', error: String(err?.message || err) } : it));
      }
    }
  };

  const activeUploads = useMemo(() => uploadItems.filter(i => i.status !== 'done'), [uploadItems]);

  const filteredAssets = useMemo(() => {
    if (categoryFilter === 'all') return assets;
    if (categoryFilter === 'uncategorized') return assets.filter(a => !a.categoryId);
    return assets.filter(a => a.categoryId === categoryFilter);
  }, [assets, categoryFilter]);

  return (
    <Droppable droppableId="library">
      {(provided, snapshot) => (
        <div
          className="uploaded-content"
          ref={provided.innerRef}
          {...provided.droppableProps}
          style={{
            minHeight: snapshot.isDraggingOver ? '200px' : 'auto'
          }}
        >
          <h3 style={{ marginBottom: 10 }}>Library</h3>
          <div style={{ display: 'flex', gap: 12 }}>
            {/* Left sidebar with controls */}
            <div style={{
              minWidth: 150,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: 10,
              background: 'var(--bg-secondary)',
              borderRadius: 4
            }}>
              <button
                className="win95-button"
                onClick={() => fileInputRef.current?.click()}
                style={{ fontSize: 11, padding: '6px 12px', width: '100%' }}
              >
                Upload Files
              </button>

              <div style={{ borderTop: '1px solid #444', paddingTop: 10 }}>
                <label style={{ fontSize: 10, color: '#ccc', display: 'block', marginBottom: 6 }}>
                  FILTER BY CATEGORY
                </label>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  style={{ fontSize: 10, padding: '4px', width: '100%' }}
                >
                  <option value="all">All ({assets.length})</option>
                  <option value="uncategorized">Uncategorized ({assets.filter(a => !a.categoryId).length})</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name} ({assets.filter(a => a.categoryId === cat.id).length})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,audio/*"
              multiple
              onChange={handleFiles}
              style={{ display: 'none' }}
            />

            {/* Main content area */}
            <div style={{ flex: 1, padding: 10, display: 'flex', flexDirection: 'column' }}>
            {activeUploads.length > 0 && (
              <div style={{ padding: 10, background: 'var(--bg-secondary)', marginBottom: 10, borderRadius: 4 }}>
                {activeUploads.map(it => (
                  <div key={it.id} style={{ fontSize: 10, marginBottom: 6, color: 'white' }}>
                    <div>{it.name} — {it.status} {it.status === 'uploading' ? `${it.progress}%` : ''}</div>
                    {it.status === 'uploading' && (
                      <div style={{ background: '#333', height: 4, borderRadius: 2, marginTop: 2 }}>
                        <div style={{ width: `${it.progress}%`, background: 'var(--brand-teal)', height: 4, borderRadius: 2 }} />
                      </div>
                    )}
                    {it.status === 'error' && (
                      <div style={{ color: 'var(--brand-pink)' }}>{it.error}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {filteredAssets.length === 0 && activeUploads.length === 0 && (
              <div style={{ padding: '12px 0', fontSize: 10, color: 'black', textAlign: 'center', fontStyle: 'italic' }}>
                {assets.length === 0 ? 'No assets yet. Click Upload Files to get started!' : 'No assets match this filter.'}
              </div>
            )}
            <div className="library-items-grid">
              <LibraryList
                assets={filteredAssets}
                categories={categories}
                onChangeTags={(assetId, tags) => {
                  setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, tags } : a)));
                  if (apiEnabled) updateAssetTags({ assetId, tags }).catch(() => {});
                }}
                onChangeCategory={(assetId, categoryId) => {
                  setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, categoryId } : a)));
                  if (apiEnabled) setAssetCategory({ assetId, categoryId }).catch(() => {});
                }}
                onChangeName={(assetId, name) => {
                  setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, name } : a)));
                  if (apiEnabled) updateAssetName({ assetId, name }).catch(() => {});
                }}
              />
            </div>
            </div>
          </div>
          {provided.placeholder}
        </div>
      )}
    </Droppable>
  );
}

