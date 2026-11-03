// Viewer analytics routes, mounted from index.js.
//
//   POST /analytics/events   public ingest (ralph-world proxies here; /embed may call direct)
//   POST /analytics/login    shared stats password -> 7-day read-only stats token
//   GET  /analytics/overview ?from=YYYY-MM-DD&to=YYYY-MM-DD&surface=tv|home|embed|all
//   GET  /analytics/shows    same params
//   GET  /analytics/live     who's watching now
//
// Stats tokens carry scope:'stats'. index.js's authMiddleware refuses them, so the
// shared password opens the stats page and nothing else in the Broadcaster.
import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { validateBatch, makeLimiter, insertRows, purgeOld, parseUA } from './analytics-ingest.js';
import { overview, shows, live, TZ } from './analytics-queries.js';

const STATS_SCOPE = 'stats';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 92;
const RETENTION_DAYS = parseInt(process.env.ANALYTICS_RETENTION_DAYS || '90', 10);

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest();
}

/** Today's date in London as YYYY-MM-DD. */
function londonToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Parse ?from&to&surface into SQL params, defaulting to the last 7 days of the TV page. */
export function rangeParams(q) {
  const to = DATE_RE.test(q.to || '') ? q.to : londonToday();
  let from = DATE_RE.test(q.from || '') ? q.from : null;
  if (!from) {
    const d = new Date(`${to}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6);
    from = d.toISOString().slice(0, 10);
  }
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  if (!(span >= 0)) return { error: 'from must be on or before to' };
  if (span > MAX_RANGE_DAYS) return { error: `range is limited to ${MAX_RANGE_DAYS} days` };
  const surface = ['tv', 'home', 'embed', 'all'].includes(q.surface) ? q.surface : 'tv';
  return { params: [from, to, surface], from, to, surface };
}

export function mountAnalytics(app, { pool, jwtSecret, loginLimiter, recordLoginFailure, clearLoginFailures }) {
  const perSession = makeLimiter(120, 60_000);   // events per page load per minute
  const perIp = makeLimiter(600, 60_000);        // events per client IP per minute
  const global = makeLimiter(6000, 60_000);      // whole-backend ceiling

  // Ingest. Accepts JSON, or text/plain JSON (what navigator.sendBeacon sends cross-origin
  // without a preflight). Always answers 204 for valid-but-limited batches so a client
  // never retries into the limit.
  app.post('/analytics/events', express.text({ type: 'text/plain', limit: '32kb' }), async (req, res) => {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ message: 'invalid JSON' }); }
    }
    // The ralph-world proxy forwards the viewer's UA and IP; direct callers use their own.
    const ua = req.get('x-viewer-ua') || req.get('user-agent') || '';
    if (parseUA(ua).bot) return res.status(204).end();
    const { rows, error } = validateBatch(body, ua);
    if (error) return res.status(400).json({ message: error });
    if (!rows.length) return res.status(204).end();
    const ip = (req.get('x-viewer-ip') || req.ip || 'unknown').split(',')[0].trim();
    if (!perSession(rows[0].session_id, rows.length) || !perIp(ip, rows.length) || !global('*', rows.length)) {
      return res.status(204).end();
    }
    try {
      await insertRows(pool, rows);
      return res.status(204).end();
    } catch (e) {
      console.error('[analytics] insert failed:', e?.message || e);
      return res.status(500).json({ message: 'insert failed' });
    }
  });

  app.post('/analytics/login', loginLimiter, (req, res) => {
    const expected = process.env.STATS_PASSWORD || '';
    if (!expected) return res.status(503).json({ message: 'Stats login is not configured (STATS_PASSWORD)' });
    const given = String(req.body?.password || '');
    if (!given || !crypto.timingSafeEqual(sha256(given), sha256(expected))) {
      recordLoginFailure(req.ip);
      return res.status(401).json({ message: 'Wrong password' });
    }
    clearLoginFailures(req.ip);
    const ttl = process.env.STATS_TOKEN_TTL || '7d';
    const token = jwt.sign({ role: 'stats', scope: STATS_SCOPE }, jwtSecret, { expiresIn: ttl });
    return res.json({ token });
  });

  // Stats token, or a Broadcaster admin/service token.
  function requireStats(req, res, next) {
    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!bearer) return res.status(401).json({ message: 'Login required' });
    const svc = process.env.SERVICE_TOKEN;
    if (svc && bearer === svc) return next();
    try {
      const d = jwt.verify(bearer, jwtSecret, { algorithms: ['HS256'] });
      if (d.scope === STATS_SCOPE || d.role === 'admin') return next();
      return res.status(403).json({ message: 'Not allowed' });
    } catch {
      return res.status(401).json({ message: 'Login expired' });
    }
  }

  function withRange(handler) {
    return async (req, res) => {
      const r = rangeParams(req.query);
      if (r.error) return res.status(400).json({ message: r.error });
      try {
        res.set('Cache-Control', 'no-store');
        return res.json({ from: r.from, to: r.to, surface: r.surface, tz: TZ, ...(await handler(r.params)) });
      } catch (e) {
        console.error('[analytics] query failed:', e?.message || e);
        return res.status(500).json({ message: 'query failed' });
      }
    };
  }

  app.get('/analytics/overview', requireStats, withRange((p) => overview(pool, p)));
  app.get('/analytics/shows', requireStats, withRange(async (p) => ({ shows: await shows(pool, p) })));
  app.get('/analytics/live', requireStats, async (_req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      return res.json(await live(pool));
    } catch (e) {
      console.error('[analytics] live failed:', e?.message || e);
      return res.status(500).json({ message: 'query failed' });
    }
  });

  // Retention: purge once shortly after boot, then daily.
  const purge = async () => {
    try {
      const n = await purgeOld(pool, RETENTION_DAYS);
      if (n) console.log(`[analytics] purged ${n} events older than ${RETENTION_DAYS} days`);
    } catch (e) {
      // Table may not exist yet if migrations haven't run — harmless, try again tomorrow.
      console.warn('[analytics] purge skipped:', e?.message || e);
    }
  };
  setTimeout(purge, 60_000).unref();
  setInterval(purge, 24 * 3600 * 1000).unref();
}

export { STATS_SCOPE };
