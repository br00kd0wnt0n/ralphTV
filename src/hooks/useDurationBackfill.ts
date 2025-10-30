import { useEffect } from 'react';
import type { Asset } from '../state/models';
import { getAssetReadUrl, setAssetDuration } from '../api/assets';
import { probeDuration } from '../utils/media';
import { CONFIG } from '../config';

export function useDurationBackfill(assets: Asset[], setAssets: (updater: (prev: Asset[]) => Asset[]) => void) {
  useEffect(() => {
    if (!CONFIG.API_BASE_URL) return;
    const missing = assets.filter(a => !a.durationSec && a.s3Key);
    if (!missing.length) return;
    let cancelled = false;
    (async () => {
      for (const a of missing) {
        try {
          const { url } = await getAssetReadUrl(a.id);
          if (!url) continue;
          const d = await probeDuration(url, a.type);
          if (cancelled || !d) continue;
          setAssets(prev => prev.map(x => x.id === a.id ? { ...x, durationSec: d } : x));
          try { await setAssetDuration(a.id, d); } catch {}
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [assets]);
}

