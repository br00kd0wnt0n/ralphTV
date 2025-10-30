export function computePointer(mode, playStart, durationsSec, now = new Date()) {
  const total = durationsSec.reduce((a, b) => a + (b || 0), 0);
  if (!total) return { index: 0, offsetSec: 0 };
  const today = new Date(now);
  const [hh, mm] = (playStart || '00:00').split(':').map((n) => parseInt(n || '0', 10));
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hh || 0, mm || 0, 0);
  let delta = Math.floor((now.getTime() - start.getTime()) / 1000);
  if (mode === 'playthru') {
    if (delta < 0) return { index: 0, offsetSec: 0 };
    if (delta >= total) return { ended: true, index: durationsSec.length - 1, offsetSec: durationsSec.at(-1) || 0 };
  }
  // loop mode or playthru within window
  if (delta < 0) delta = ((delta % total) + total) % total; // normalize negative
  const t = mode === 'loop' ? (delta % total) : delta;
  let acc = 0;
  for (let i = 0; i < durationsSec.length; i++) {
    const d = durationsSec[i] || 0;
    if (t < acc + d) return { index: i, offsetSec: t - acc };
    acc += d;
  }
  return { index: durationsSec.length - 1, offsetSec: 0 };
}

