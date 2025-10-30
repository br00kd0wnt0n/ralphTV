import React, { useEffect, useRef } from 'react';
import type { Asset } from '../state/models';
import Player from '@vimeo/player';
import { getAssetReadUrl } from '../api/assets';

export default function PreviewPane({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!asset) return;
    let player: Player | null = null;
    let mounted = true;
    (async () => {
      if (asset.vimeoReference && containerRef.current) {
        player = new Player(containerRef.current, { id: asset.vimeoReference, autoplay: true, muted: true });
      } else if (!asset.url && asset.s3Key) {
        // fetch presigned GET url
        const res = await getAssetReadUrl(asset.id).catch(() => null);
        if (res?.url && containerRef.current) {
          const el = document.createElement(asset.type === 'audio' ? 'audio' : 'video');
          el.controls = true; el.autoplay = true; el.src = res.url; el.style.width = '100%';
          containerRef.current.innerHTML = '';
          containerRef.current.appendChild(el);
        }
      } else if (asset.url && containerRef.current) {
        const el = document.createElement(asset.type === 'audio' ? 'audio' : 'video');
        el.controls = true; el.autoplay = true; el.src = asset.url; el.style.width = '100%';
        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(el);
      }
    })();
    return () => { mounted = false; if (player) try { player.destroy(); } catch {} };
  }, [asset]);

  if (!asset) return null;
  return (
    <div style={{ position: 'sticky', top: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: '6px 0' }}>Preview</h3>
        <button onClick={onClose}>Close</button>
      </div>
      <div style={{ fontSize: 12, marginBottom: 6 }}>{asset.name}</div>
      <div ref={containerRef} style={{ width: '100%', background: '#000', borderRadius: 6, minHeight: 160 }} />
    </div>
  );
}

