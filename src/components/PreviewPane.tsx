import React, { useEffect, useRef, useState } from 'react';
import type { Asset, Category } from '../state/models';
import Player from '@vimeo/player';
import { getAssetReadUrl, updateAssetDescription } from '../api/assets';
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
  categories,
  onChangeDescription,
}: {
  asset: Asset | null;
  onClose: () => void;
  categories?: Category[];
  /** Optional callback so the parent can mirror the description into its
   *  local asset state — same pattern as onChangeName on the library list. */
  onChangeDescription?: (assetId: string, description: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Local draft so the textarea stays editable without every keystroke
  // firing a save. Committed on blur (or Cmd+Enter). Resets whenever a
  // different asset gets selected.
  const [descDraft, setDescDraft] = useState<string>(asset?.description ?? '');
  const [descSaving, setDescSaving] = useState(false);
  const [descSavedAt, setDescSavedAt] = useState<Date | null>(null);
  useEffect(() => {
    setDescDraft(asset?.description ?? '');
    setDescSavedAt(null);
  }, [asset?.id, asset?.description]);

  const commitDescription = async () => {
    if (!asset) return;
    const current = (asset.description ?? '').trim();
    const next = descDraft.trim();
    if (next === current) return;
    setDescSaving(true);
    try {
      await updateAssetDescription({ assetId: asset.id, description: next });
      onChangeDescription?.(asset.id, next);
      setDescSavedAt(new Date());
    } catch (err) {
      console.error('updateAssetDescription failed', err);
    } finally {
      setDescSaving(false);
    }
  };

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
    // Re-init only when the asset identity or its media source changes — not when an
    // unrelated field (e.g. normStatus from the status poll) updates, which would
    // otherwise tear down and reload the player mid-playback.
  }, [asset?.id, asset?.url, asset?.s3Key, asset?.vimeoReference, asset?.type]);

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

          {/* Show blurb — flows to ralph-world's TeletextShowInfo overlay
              as the current-show description. Save on blur (or Cmd/Ctrl+
              Enter). Empty saves clear the field. */}
          <div className="metadata-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Description:</span>
              <span style={{ fontSize: 10, color: '#808080', fontWeight: 'normal' }}>
                {descSaving
                  ? 'Saving…'
                  : descSavedAt
                    ? `Saved ${descSavedAt.toLocaleTimeString()}`
                    : 'Ralph TV show info'}
              </span>
            </label>
            <textarea
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value.slice(0, 2000))}
              onBlur={commitDescription}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  commitDescription();
                }
              }}
              placeholder="What the audience should know about this show…"
              rows={4}
              style={{
                width: '100%',
                fontSize: 11,
                lineHeight: 1.4,
                padding: 6,
                background: '#1a1a1a',
                color: '#eee',
                border: '1px solid #333',
                borderRadius: 3,
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
            <span style={{ fontSize: 10, color: '#666', alignSelf: 'flex-end' }}>
              {descDraft.length}/2000
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

