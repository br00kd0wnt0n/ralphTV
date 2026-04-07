import React, { useEffect, useRef, useState } from 'react';
import type { Asset, Category } from '../state/models';
import Player from '@vimeo/player';
import { getAssetReadUrl } from '../api/assets';
import { formatDuration } from '../state/schedule';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

export default function PreviewPane({
  asset,
  onClose,
  categories
}: {
  asset: Asset | null;
  onClose: () => void;
  categories?: Category[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!asset || !containerRef.current) return;
    let player: Player | null = null;
    let mounted = true;
    let objectUrl: string | null = null;

    const createMediaEl = (src: string) => {
      if (!containerRef.current || !mounted) return;
      const el = document.createElement(asset.type === 'audio' ? 'audio' : 'video');
      el.controls = true; el.autoplay = false; el.src = src; el.style.width = '100%';
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(el);
    };

    (async () => {
      if (asset.vimeoReference && containerRef.current) {
        player = new Player(containerRef.current, { id: asset.vimeoReference, autoplay: false, muted: true });
      } else if (!asset.url && asset.s3Key) {
        const res = await getAssetReadUrl(asset.id).catch(() => null);
        if (res?.url) createMediaEl(res.url);
      } else if (asset.url) {
        createMediaEl(asset.url);
      }
    })();
    return () => {
      mounted = false;
      if (player) try { player.destroy(); } catch {}
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset]);

  const category = categories?.find(c => c.id === asset?.categoryId);

  return (
    <div className="asset-preview-panel">
      <div className="preview-header">
        <h4>Asset Preview</h4>
      </div>

      <div ref={containerRef} className="preview-player" style={{ background: '#000', minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {!asset && (
          <div style={{ color: '#808080', fontSize: 12 }}>
            Select an asset to preview
          </div>
        )}
      </div>

      {asset && (
        <div className="preview-metadata">
          <div className="metadata-row">
            <label>Name:</label>
            <span>{asset.name}</span>
          </div>
          <div className="metadata-row">
            <label>Type:</label>
            <span style={{ textTransform: 'uppercase' }}>{asset.type}</span>
          </div>
          {asset.durationSec && (
            <div className="metadata-row">
              <label>Duration:</label>
              <span>{formatDuration(asset.durationSec)}</span>
            </div>
          )}
          {asset.size && (
            <div className="metadata-row">
              <label>Size:</label>
              <span>{formatBytes(asset.size)}</span>
            </div>
          )}
          {category && (
            <div className="metadata-row">
              <label>Category:</label>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: '0 0 auto' }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: category.color,
                    border: '1px solid rgba(255,255,255,0.3)',
                    display: 'inline-block',
                    flexShrink: 0,
                    boxShadow: `0 0 8px ${category.color}50`
                  }}
                />
                {category.name}
              </span>
            </div>
          )}
          {asset.tags && asset.tags.length > 0 && (
            <div className="metadata-row">
              <label>Tags:</label>
              <div className="tags-list">
                {asset.tags.map((tag, i) => (
                  <span key={i} className="tag-badge">{tag}</span>
                ))}
              </div>
            </div>
          )}
          {asset.uploadedAt && (
            <div className="metadata-row">
              <label>Uploaded:</label>
              <span>{new Date(asset.uploadedAt).toLocaleDateString()}</span>
            </div>
          )}
          {asset.vimeoReference && (
            <div className="metadata-row">
              <label>Vimeo ID:</label>
              <span>{asset.vimeoReference}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

