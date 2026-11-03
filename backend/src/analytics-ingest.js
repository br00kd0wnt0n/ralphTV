// Viewer-event ingest for the Ralph TV player: validation, coarse UA parsing, rate
// limits and the batched insert. Anonymous by design — nothing here stores an IP,
// user-agent string, user id or email. See migrations/0010_viewer_events.sql.

// Event names the player may send. Anything else is dropped. Keep these stable once
// shipped: the stats queries and the GTM mirror (`ralphtv_<name>`) both key on them.
export const EVENTS = new Set([
  'page_view',        // player page mounted (props: ref, utm_*, is_guest, live, gate_on_arrival)
  'play_start',       // first frame actually playing this page load
  'heartbeat',        // every HEARTBEAT_SEC while playing + tab visible
  'show_change',      // clip on screen changed while watching (props.prev_asset_id)
  'unmute', 'mute',
  'tap_to_watch',     // mobile poster tapped -> immersive player
  'immersive_exit',
  'fullscreen_enter',
  'overlay_open',     // props.kind: info | schedule
  'gate_shown',       // guest preview gate appeared (props.on_arrival)
  'subscribe_click',
  'offline_view',     // page shown while the channel was off air
  'stall', 'error',   // props.kind
  'hidden', 'visible',// tab hidden / back (a session's last 'hidden' is usually its exit)
  // Reserved for on-demand playback + sharing (not sent yet).
  'vod_play', 'back_to_live', 'share',
]);

export const SURFACES = new Set(['tv', 'home', 'embed']);
export const HEARTBEAT_SEC = 15;

// Allowed `props` keys and their max string length. Booleans/numbers pass as-is.
const PROP_LIMITS = {
  ref: 80, utm_source: 60, utm_medium: 60, utm_campaign: 80,
  is_guest: 0, live: 0, gate_on_arrival: 0, on_arrival: 0,
  kind: 40, prev_asset_id: 36, path: 80,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BATCH = 25;
const MAX_INT = 7 * 24 * 3600; // a week of seconds; anything above is junk

const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|pingdom|uptime|monitor|curl|wget|python|node-fetch|axios/i;

/** Coarse device + browser family from a UA string. The UA itself is never stored. */
export function parseUA(ua = '') {
  const s = String(ua);
  let device = 'desktop';
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(s)) device = 'tablet';
  else if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(s)) device = 'mobile';
  let browser = 'other';
  if (/SamsungBrowser/i.test(s)) browser = 'samsung';
  else if (/Edg\//i.test(s)) browser = 'edge';
  else if (/Firefox|FxiOS/i.test(s)) browser = 'firefox';
  else if (/Chrome|CriOS/i.test(s)) browser = 'chrome';
  else if (/Safari/i.test(s)) browser = 'safari';
  return { device, browser, bot: BOT_RE.test(s) };
}

function cleanInt(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= MAX_INT ? n : null;
}

function cleanProps(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (!(k in PROP_LIMITS)) continue;
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
    else if (typeof v === 'string' && PROP_LIMITS[k] > 0) out[k] = v.slice(0, PROP_LIMITS[k]);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Validate an ingest body. Returns { rows } (possibly empty) or { error }.
 * Body: { session_id, surface, events: [{ event, asset_id?, offset_sec?, watch_sec?, muted?, props? }] }
 */
export function validateBatch(body, ua) {
  if (!body || typeof body !== 'object') return { error: 'body must be a JSON object' };
  const { session_id: sid, surface, events } = body;
  if (typeof sid !== 'string' || !UUID_RE.test(sid)) return { error: 'session_id must be a uuid' };
  if (!SURFACES.has(surface)) return { error: 'unknown surface' };
  if (!Array.isArray(events) || events.length === 0) return { error: 'events must be a non-empty array' };
  if (events.length > MAX_BATCH) return { error: `at most ${MAX_BATCH} events per batch` };
  const { device, browser } = parseUA(ua);
  const rows = [];
  for (const e of events) {
    if (!e || typeof e !== 'object' || !EVENTS.has(e.event)) continue; // drop, don't fail the batch
    const assetId = typeof e.asset_id === 'string' && UUID_RE.test(e.asset_id) ? e.asset_id : null;
    rows.push({
      event: e.event, session_id: sid, surface, device, browser,
      asset_id: assetId,
      offset_sec: cleanInt(e.offset_sec),
      watch_sec: cleanInt(e.watch_sec),
      muted: typeof e.muted === 'boolean' ? e.muted : null,
      props: cleanProps(e.props),
    });
  }
  return { rows };
}

/**
 * Sliding-window limiter keyed by an arbitrary string (session id, IP, or '*').
 * In memory — fine for one backend instance at this audience size.
 */
export function makeLimiter(max, windowMs) {
  const hits = new Map(); // key -> { count, resetAt }
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, h] of hits) if (h.resetAt <= now) hits.delete(k);
  }, windowMs);
  timer.unref?.();
  return function take(key, n = 1) {
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.resetAt <= now) { h = { count: 0, resetAt: now + windowMs }; hits.set(key, h); }
    if (h.count + n > max) return false;
    h.count += n;
    return true;
  };
}

/** Multi-row insert. Server stamps ts. */
export async function insertRows(pool, rows) {
  if (!rows.length) return;
  const cols = ['event', 'session_id', 'surface', 'device', 'browser', 'asset_id', 'offset_sec', 'watch_sec', 'muted', 'props'];
  const params = [];
  const tuples = rows.map((r) => {
    const ph = cols.map((c) => {
      params.push(c === 'props' && r.props ? JSON.stringify(r.props) : r[c]);
      return `$${params.length}`;
    });
    return `(${ph.join(',')})`;
  });
  await pool.query(`insert into viewer_events (${cols.join(',')}) values ${tuples.join(',')}`, params);
}

/** Delete events older than `days`. Returns the number of rows removed. */
export async function purgeOld(pool, days = 90) {
  const r = await pool.query(`delete from viewer_events where ts < now() - make_interval(days => $1)`, [days]);
  return r.rowCount || 0;
}
