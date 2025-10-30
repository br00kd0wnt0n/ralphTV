export async function probeDuration(url: string, kind: 'video'|'audio'|'unknown'): Promise<number | undefined> {
  return new Promise((resolve) => {
    if (kind !== 'video' && kind !== 'audio') return resolve(undefined);
    const el: HTMLMediaElement = document.createElement(kind);
    el.preload = 'metadata';
    el.crossOrigin = 'anonymous';
    el.src = url;
    const cleanup = () => {
      el.removeAttribute('src');
      try { el.load(); } catch {}
    };
    el.onloadedmetadata = () => {
      const d = el.duration;
      cleanup();
      resolve(isFinite(d) && d > 0 ? Math.round(d) : undefined);
    };
    el.onerror = () => { cleanup(); resolve(undefined); };
  });
}

