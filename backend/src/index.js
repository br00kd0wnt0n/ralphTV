import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  UploadPartCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { WebSocketServer } from 'ws';
import { computePointer } from './feed.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.includes('*') ? true : allowedOrigins,
    credentials: false,
  })
);

// Postgres
const isLocalDb = (process.env.DATABASE_URL || '').includes('localhost') || (process.env.DATABASE_URL || '').includes('127.0.0.1');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway Postgres uses self-signed certs — require SSL but don't verify the chain
  ...(isLocalDb ? {} : { ssl: { rejectUnauthorized: false } }),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// S3 client if env present
const hasS3 = !!(process.env.AWS_REGION && process.env.S3_BUCKET_UPLOADS);
const s3 = hasS3
  ? new S3Client({ region: process.env.AWS_REGION })
  : null;

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('FATAL: JWT_SECRET must be set in production');
  process.exit(1);
}
const _JWT_SECRET = JWT_SECRET || 'dev-secret-change-me';
const SERVICE_TOKEN = process.env.SERVICE_TOKEN || '';

// Health
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('/health', (req, res) => res.json({ ok: true }));

// nginx-rtmp publish-auth callback (opt-in; wired via the relay's
// RELAY_PUBLISH_AUTH_URL). nginx posts urlencoded fields including the publish query
// args, so a publisher pushing rtmp://relay/live/stream?key=SECRET arrives here with
// body.key=SECRET. We allow only when it matches RELAY_PUBLISH_KEY. Intentionally
// unauthenticated — nginx-rtmp can't carry a bearer token — but it reveals nothing and
// only ever returns allow/deny. Returns 2xx to allow publishing, 403 to reject.
const RELAY_PUBLISH_KEY = process.env.RELAY_PUBLISH_KEY || '';
app.post('/relay/publish-auth', express.urlencoded({ extended: false }), (req, res) => {
  if (!RELAY_PUBLISH_KEY) {
    // Callback is wired but no key configured — fail closed rather than allow all.
    console.error('[relay] publish-auth called but RELAY_PUBLISH_KEY is unset; denying');
    return res.status(403).end();
  }
  const provided = req.body?.key || '';
  if (String(provided) === String(RELAY_PUBLISH_KEY)) return res.status(201).end();
  console.warn(`[relay] publish rejected name=${req.body?.name || '?'} addr=${req.body?.addr || '?'}`);
  return res.status(403).end();
});

// Auth helpers
function signToken(payload) {
  return jwt.sign(payload, _JWT_SECRET, { expiresIn: '2h' });
}

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  let bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const svcHeader = req.headers['x-service-token'];
  // Service token accepts either Bearer or X-Service-Token
  const tryService = (t) => SERVICE_TOKEN && t && String(t) === String(SERVICE_TOKEN);
  if (tryService(bearer) || tryService(svcHeader)) {
    req.user = { userId: 'service', email: 'service@ralphtv', role: 'service' };
    return next();
  }
  if (!bearer) return res.status(403).json({ message: 'No token provided' });
  try {
    // Pin the algorithm so a token can't downgrade to alg:none / RS256 confusion.
    const decoded = jwt.verify(bearer, _JWT_SECRET, { algorithms: ['HS256'] });
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

// Gate for state-mutating routes. Admins and the service worker always pass.
// Tokens with NO role claim are allowed too (the Ralph.World CMS SSO bridge does
// not yet stamp a role) but are logged so we can tighten this once the CMS adds
// role:'admin'. Any token carrying an explicit non-admin role (e.g. 'viewer') is
// rejected — that is the actual privilege boundary we're protecting.
function requireWrite(req, res, next) {
  const role = req.user?.role;
  if (role === 'admin' || role === 'service') return next();
  if (role === undefined || role === null || role === '') {
    console.warn(
      `[authz] write allowed for roleless token user=${req.user?.email || req.user?.userId || 'unknown'} ` +
      `path=${req.method} ${req.path} — CMS should stamp role:'admin' on SSO tokens`
    );
    return next();
  }
  return res.status(403).json({ message: 'Admin access required' });
}

// Auth routes
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ message: 'Missing credentials' });
  try {
    const { rows } = await pool.query('select id, email, password_hash, role from users where email=$1', [email]);
    if (!rows.length) return res.status(401).json({ message: 'Authentication failed' });
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: 'Authentication failed' });
    const token = signToken({ userId: user.id, email: user.email, role: user.role });
    return res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (e) {
    console.error('login error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.get('/api/protected', authMiddleware, (req, res) => {
  return res.json({ message: 'Access granted', user: req.user });
});

// Uploads
app.post('/uploads/init', authMiddleware, requireWrite, async (req, res) => {
  const { fileName, mimeType, size } = req.body || {};
  if (!fileName || !mimeType || typeof size !== 'number') return res.status(400).json({ message: 'Missing fields' });
  if (!hasS3) return res.status(501).json({ message: 'S3 not configured' });

  // Validate MIME type
  const allowedMimeTypes = /^(video|audio|image)\//;
  if (!allowedMimeTypes.test(mimeType)) return res.status(400).json({ message: 'Unsupported file type' });

  // Sanitize filename
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '.').slice(0, 255);

  try {
    const fileId = uuidv4();
    const keyPrefix = process.env.S3_PREFIX || 'raw';
    const userPrefix = req.user?.userId || 'anon';
    const s3Key = `${keyPrefix}/${userPrefix}/${fileId}/${safeName}`;

    const thresholdMB = parseInt(process.env.MULTIPART_THRESHOLD_MB || '100', 10);
    if (size < thresholdMB * 1024 * 1024) {
      // Single PUT
      const put = new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_UPLOADS,
        Key: s3Key,
        ContentType: mimeType,
      });
      const url = await getSignedUrl(s3, put, { expiresIn: (parseInt(process.env.PRESIGN_TTL_MINUTES || '10', 10)) * 60 });
      return res.json({ kind: 'single', fileId, s3Key, url, headers: { 'Content-Type': mimeType }, expiresAt: new Date(Date.now() + (parseInt(process.env.PRESIGN_TTL_MINUTES || '10', 10)) * 60 * 1000).toISOString() });
    }

    // Multipart placeholder (requires UploadPartCommand for each part). Implement per-part signing route in follow-up.
    const create = new CreateMultipartUploadCommand({
      Bucket: process.env.S3_BUCKET_UPLOADS,
      Key: s3Key,
      ContentType: mimeType,
    });
    const created = await s3.send(create);
    const uploadId = created.UploadId;
    const parts = parseInt(process.env.MULTIPART_PARTS || '6', 10);
    // Return part count; client will request per-part URLs via /uploads/part-url
    return res.json({ kind: 'multipart', fileId, s3Key, uploadId, parts });
  } catch (e) {
    console.error('uploads/init error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.post('/uploads/complete', authMiddleware, requireWrite, async (req, res) => {
  const { fileId, uploadId, parts, s3Key, fileName, mimeType, size, durationSec } = req.body || {};
  if (!fileId) return res.status(400).json({ message: 'Missing fileId' });
  if (!hasS3) return res.status(501).json({ message: 'S3 not configured' });
  try {
    if (uploadId && Array.isArray(parts) && parts.length) {
      const complete = new CompleteMultipartUploadCommand({
        Bucket: process.env.S3_BUCKET_UPLOADS,
        Key: s3Key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts.map((p) => ({ ETag: p.etag, PartNumber: p.partNumber })) },
      });
      await s3.send(complete);
    }

    if (fileName && mimeType && typeof size === 'number' && s3Key) {
      const fileType = mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('audio/') ? 'audio' : 'unknown';
      await pool.query(
        `insert into assets (id, file_name, mime_type, size, s3_key, file_type, duration_sec, norm_status)
         values ($1,$2,$3,$4,$5,$6,$7,'pending')
         on conflict (id) do update set duration_sec = coalesce(excluded.duration_sec, assets.duration_sec)`,
        [fileId, fileName, mimeType, size, s3Key, fileType, (typeof durationSec === 'number' ? durationSec : null)]
      );
      // enqueue normalization job
      await pool.query(
        `insert into normalize_jobs (asset_id, status) values ($1,'pending')
         on conflict do nothing`,
        [fileId]
      );
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('uploads/complete error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Per-part presign URL for multipart upload
app.get('/uploads/part-url', authMiddleware, requireWrite, async (req, res) => {
  if (!hasS3) return res.status(501).json({ message: 'S3 not configured' });
  const { uploadId, key, partNumber } = req.query || {};
  const pn = parseInt(partNumber, 10);
  if (!uploadId || !key || !pn) return res.status(400).json({ message: 'Missing query params' });
  try {
    const cmd = new UploadPartCommand({
      Bucket: process.env.S3_BUCKET_UPLOADS,
      Key: key,
      UploadId: uploadId,
      PartNumber: pn,
    });
    const url = await getSignedUrl(s3, cmd, { expiresIn: (parseInt(process.env.PRESIGN_TTL_MINUTES || '10', 10)) * 60 });
    return res.json({ partNumber: pn, url });
  } catch (e) {
    console.error('part-url error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Schedule helpers
async function getOrCreateScheduleId(client, channel, week, day) {
  const { rows } = await client.query('select id, version from schedules where channel=$1 and week=$2 and day=$3', [channel, week, day]);
  if (rows.length) return rows[0];
  const ins = await client.query('insert into schedules (id, channel, week, day) values (gen_random_uuid(), $1, $2, $3) returning id, version', [channel, week, day]);
  return ins.rows[0];
}

app.get('/schedule/:channel/:week/:day', authMiddleware, async (req, res) => {
  const { channel, week, day } = req.params;
  try {
    const client = await pool.connect();
    try {
      const schedRow = await getOrCreateScheduleId(client, channel, week, day);
      const { rows: items } = await client.query('select id, asset_id as "assetId", position from schedule_items where schedule_id=$1 order by position asc', [schedRow.id]);
      return res.json({ version: schedRow.version, items, playbackMode: schedRow.playback_mode, playStart: schedRow.play_start });
    } finally { client.release(); }
  } catch (e) {
    console.error('schedule get error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.put('/schedule/:channel/:week/:day', authMiddleware, requireWrite, async (req, res) => {
  const { channel, week, day } = req.params;
  const { items, playbackMode, playStart } = req.body || {};
  const ifMatch = parseInt(req.headers['if-match'] || '0', 10) || 0;
  if (!Array.isArray(items)) return res.status(400).json({ message: 'Invalid items' });
  try {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const schedRow = await getOrCreateScheduleId(client, channel, week, day);
      const updated = await client.query(
        'update schedules set version = version + 1, updated_at = now(), playback_mode = coalesce($3, playback_mode), play_start = coalesce($4, play_start) where id=$1 and version=$2 returning version, playback_mode, play_start',
        [schedRow.id, ifMatch, playbackMode ?? null, playStart ?? null]
      );
      if (!updated.rowCount) {
        await client.query('rollback');
        const { rows: itemsLatest } = await client.query('select id, asset_id as "assetId", position from schedule_items where schedule_id=$1 order by position asc', [schedRow.id]);
        return res.status(409).json({ doc: { version: schedRow.version, items: itemsLatest } });
      }
      await client.query('delete from schedule_items where schedule_id=$1', [schedRow.id]);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await client.query('insert into schedule_items (id, schedule_id, position, asset_id) values (gen_random_uuid(), $1, $2, $3)', [schedRow.id, i, it.assetId]);
      }
      const row = updated.rows[0];
      await client.query('commit');
      // Realtime broadcast
      broadcast(`schedule:${channel}:${week}:${day}`, { doc: { version: row.version, items } });
      return res.json({ version: row.version, items, playbackMode: row.playback_mode, playStart: row.play_start });
    } catch (e) {
      try { await client.query('rollback'); } catch (rbErr) { console.error('rollback failed', rbErr.message); }
      throw e;
    } finally { client.release(); }
  } catch (e) {
    console.error('schedule put error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.patch('/schedule/:channel/:week/:day', authMiddleware, requireWrite, async (req, res) => {
  const { channel, week, day } = req.params;
  const { ops, playbackMode, playStart } = req.body || {};
  const ifMatch = parseInt(req.headers['if-match'] || '0', 10) || 0;
  if (!Array.isArray(ops)) return res.status(400).json({ message: 'Invalid ops' });
  try {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const schedRow = await getOrCreateScheduleId(client, channel, week, day);
      const updated = await client.query(
        'update schedules set version = version + 1, updated_at = now(), playback_mode = coalesce($3, playback_mode), play_start = coalesce($4, play_start) where id=$1 and version=$2 returning version, playback_mode, play_start',
        [schedRow.id, ifMatch, playbackMode ?? null, playStart ?? null]
      );
      if (!updated.rowCount) {
        await client.query('rollback');
        const { rows: itemsLatest } = await client.query('select id, asset_id as "assetId", position from schedule_items where schedule_id=$1 order by position asc', [schedRow.id]);
        return res.status(409).json({ doc: { version: schedRow.version, items: itemsLatest } });
      }
      const { rows: current } = await client.query('select id, asset_id as "assetId", position from schedule_items where schedule_id=$1 order by position asc', [schedRow.id]);
      let items = current.map((r) => ({ id: r.id, assetId: r.assetId }));
      for (const op of ops) {
        if (op.type === 'add') {
          items.splice(op.index, 0, op.item);
        } else if (op.type === 'remove') {
          items.splice(op.index, 1);
        } else if (op.type === 'move') {
          const [m] = items.splice(op.fromIndex, 1);
          items.splice(op.toIndex, 0, m);
        }
      }
      await client.query('delete from schedule_items where schedule_id=$1', [schedRow.id]);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await client.query('insert into schedule_items (id, schedule_id, position, asset_id) values (gen_random_uuid(), $1, $2, $3)', [schedRow.id, i, it.assetId]);
      }
      const row = updated.rows[0];
      await client.query('commit');
      // Realtime broadcast
      broadcast(`schedule:${channel}:${week}:${day}`, { doc: { version: row.version, items } });
      return res.json({ version: row.version, items, playbackMode: row.playback_mode, playStart: row.play_start });
    } catch (e) {
      try { await client.query('rollback'); } catch (rbErr) { console.error('rollback failed', rbErr.message); }
      throw e;
    } finally { client.release(); }
  } catch (e) {
    console.error('schedule patch error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Tags endpoint
app.post('/assets/:id/tags', authMiddleware, requireWrite, async (req, res) => {
  const assetId = req.params.id;
  const { tags } = req.body || {};
  if (!Array.isArray(tags)) return res.status(400).json({ message: 'Invalid tags' });
  try {
    const client = await pool.connect();
    try {
      await client.query('begin');
      // Batch upsert all tags in one query
      const tagValues = tags.map((_, i) => `(gen_random_uuid(), $${i + 1})`).join(', ');
      const { rows: tagRows } = await client.query(
        `insert into tags (id, name) values ${tagValues} on conflict (name) do update set name=excluded.name returning id`,
        tags
      );
      const ids = tagRows.map(r => r.id);
      await client.query('delete from asset_tags where asset_id=$1', [assetId]);
      if (ids.length) {
        const atValues = ids.map((_, i) => `($1, $${i + 2})`).join(', ');
        await client.query(
          `insert into asset_tags (asset_id, tag_id) values ${atValues} on conflict do nothing`,
          [assetId, ...ids]
        );
      }
      await client.query('commit');
      return res.json({ ok: true, tags });
    } catch (e) {
      try { await client.query('rollback'); } catch (rbErr) { console.error('rollback failed', rbErr.message); }
      throw e;
    } finally { client.release(); }
  } catch (e) {
    console.error('tags error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Categories CRUD
app.get('/categories', authMiddleware, async (_req, res) => {
  try {
    const { rows } = await pool.query('select id, name, color from categories order by name asc');
    return res.json({ categories: rows });
  } catch (e) {
    console.error('categories list error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.post('/categories', authMiddleware, requireWrite, async (req, res) => {
  const { name, color } = req.body || {};
  if (!name || !color) return res.status(400).json({ message: 'Missing fields' });
  try {
    const { rows } = await pool.query('insert into categories (name, color) values ($1,$2) returning id, name, color', [name, color]);
    const category = rows[0];
    broadcast('categories', { event: 'created', category });
    return res.json({ category });
  } catch (e) {
    console.error('categories create error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.patch('/categories/:id', authMiddleware, requireWrite, async (req, res) => {
  const id = req.params.id;
  const { name, color } = req.body || {};
  try {
    const { rows } = await pool.query('update categories set name=coalesce($2,name), color=coalesce($3,color) where id=$1 returning id, name, color', [id, name ?? null, color ?? null]);
    if (!rows.length) return res.status(404).json({ message: 'Not found' });
    const category = rows[0];
    broadcast('categories', { event: 'updated', category });
    return res.json({ category });
  } catch (e) {
    console.error('categories update error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.delete('/categories/:id', authMiddleware, requireWrite, async (req, res) => {
  const id = req.params.id;
  try {
    await pool.query('delete from categories where id=$1', [id]);
    broadcast('categories', { event: 'deleted', id });
    return res.json({ ok: true });
  } catch (e) {
    console.error('categories delete error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Asset category, asset list, and duration update
app.post('/assets/:id/category', authMiddleware, requireWrite, async (req, res) => {
  const id = req.params.id;
  const { categoryId } = req.body || {};
  try {
    await pool.query('update assets set category_id=$2 where id=$1', [id, categoryId || null]);
    return res.json({ ok: true });
  } catch (e) {
    console.error('asset category error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.get('/assets', authMiddleware, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      select a.id, a.file_name, a.mime_type, a.size, a.s3_key, a.file_type, a.uploaded_at, a.vimeo_reference, a.duration_sec, a.thumbnail_url, a.category_id, a.norm_status, a.s3_key_norm,
             coalesce(array_agg(t.name) filter (where t.name is not null), '{}') as tags
      from assets a
      left join asset_tags at on at.asset_id = a.id
      left join tags t on t.id = at.tag_id
      group by a.id
      order by a.uploaded_at desc
    `);
    return res.json({ assets: rows });
  } catch (e) {
    console.error('assets list error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Presigned GET URL to read asset for metadata probing
app.get('/assets/:id/url', authMiddleware, async (req, res) => {
  if (!hasS3) return res.status(501).json({ message: 'S3 not configured' });
  const id = req.params.id;
  try {
    const { rows } = await pool.query(
      'select s3_key, s3_key_norm, norm_status, mime_type from assets where id=$1',
      [id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Not found' });

    // Prefer normalized version if available and ready
    const useNormalized = rows[0].s3_key_norm && rows[0].norm_status === 'ready';
    const key = useNormalized ? rows[0].s3_key_norm : rows[0].s3_key;

    // Asset URL resolved: useNormalized=${useNormalized}

    const cmd = new GetObjectCommand({ Bucket: process.env.S3_BUCKET_UPLOADS, Key: key });
    const url = await getSignedUrl(s3, cmd, { expiresIn: (parseInt(process.env.PRESIGN_TTL_MINUTES || '10', 10)) * 60 });
    return res.json({
      url,
      normalized: useNormalized,
      normStatus: rows[0].norm_status,
      s3Key: rows[0].s3_key,
      s3KeyNorm: rows[0].s3_key_norm,
      mimeType: rows[0].mime_type
    });
  } catch (e) {
    console.error('asset url error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Update duration
app.post('/assets/:id/duration', authMiddleware, requireWrite, async (req, res) => {
  const id = req.params.id;
  const { durationSec } = req.body || {};
  if (typeof durationSec !== 'number' || durationSec <= 0) return res.status(400).json({ message: 'Invalid duration' });
  try {
    await pool.query('update assets set duration_sec=$2 where id=$1', [id, Math.round(durationSec)]);
    return res.json({ ok: true });
  } catch (e) {
    console.error('asset duration error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Update asset name
app.post('/assets/:id/name', authMiddleware, requireWrite, async (req, res) => {
  const id = req.params.id;
  const { name } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ message: 'Invalid name' });
  try {
    await pool.query('update assets set file_name=$2 where id=$1', [id, name.trim()]);
    return res.json({ ok: true });
  } catch (e) {
    console.error('asset name update error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.delete('/assets/:id', authMiddleware, requireWrite, async (req, res) => {
  const id = req.params.id;
  try {
    // Delete from database (cascade will handle scheduled_items references)
    const result = await pool.query('delete from assets where id=$1 returning s3_key', [id]);

    // Note: We don't delete from S3 immediately for safety - files can be cleaned up manually
    // or via a separate cleanup job if needed

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Asset not found' });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('asset delete error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Stream action logging
app.post('/stream-actions/log', authMiddleware, requireWrite, async (req, res) => {
  const { action } = req.body || {};
  if (!action || !['start', 'stop', 'restart'].includes(action)) {
    return res.status(400).json({ message: 'Invalid action' });
  }
  const userEmail = req.user?.email || 'unknown';
  try {
    await pool.query(
      'insert into stream_actions (action, user_email) values ($1, $2)',
      [action, userEmail]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('stream action log error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.get('/stream-actions/last', authMiddleware, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      select action, user_email, created_at
      from stream_actions
      order by created_at desc
      limit 1
    `);
    if (rows.length === 0) {
      return res.json({ action: null });
    }
    return res.json({ action: rows[0] });
  } catch (e) {
    console.error('stream action fetch error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Podcast RSS feed
const RSS_TITLE = process.env.RSS_TITLE || 'RalphTV';
const RSS_DESCRIPTION = process.env.RSS_DESCRIPTION || 'RalphTV Video Podcast';
const RSS_LINK = process.env.RSS_LINK || 'https://ralphtv.com';
const RSS_LANGUAGE = process.env.RSS_LANGUAGE || 'en';
const RSS_CATEGORY = process.env.RSS_CATEGORY || 'TV & Film';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';

function escapeXml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function stripExtension(name) {
  return name.replace(/\.[^.]+$/, '');
}

function formatItunesDuration(sec) {
  if (!sec || sec <= 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

app.get('/feed/rss', async (_req, res) => {
  if (!R2_PUBLIC_URL) {
    return res.status(503).json({ message: 'R2_PUBLIC_URL not configured' });
  }
  try {
    const { rows } = await pool.query(`
      select id, file_name, mime_type, size, s3_key_norm, duration_sec, thumbnail_url, uploaded_at
      from assets
      where file_type = 'video' and norm_status = 'ready' and s3_key_norm is not null
      order by uploaded_at desc
    `);

    const baseUrl = R2_PUBLIC_URL.replace(/\/$/, '');
    const buildDate = new Date().toUTCString();

    const items = rows.map((r) => {
      const enclosureUrl = `${baseUrl}/${r.s3_key_norm}`;
      const title = escapeXml(stripExtension(r.file_name));
      const pubDate = new Date(r.uploaded_at).toUTCString();
      const duration = formatItunesDuration(r.duration_sec);
      const imageTag = r.thumbnail_url
        ? `      <itunes:image href="${escapeXml(r.thumbnail_url)}" />`
        : '';

      return `    <item>
      <title>${title}</title>
      <enclosure url="${escapeXml(enclosureUrl)}" length="${r.size || 0}" type="${escapeXml(r.mime_type)}" />
      <guid isPermaLink="false">${escapeXml(enclosureUrl)}</guid>
      <pubDate>${pubDate}</pubDate>
      <itunes:duration>${duration}</itunes:duration>
${imageTag}
    </item>`;
    }).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(RSS_TITLE)}</title>
    <description>${escapeXml(RSS_DESCRIPTION)}</description>
    <link>${escapeXml(RSS_LINK)}</link>
    <language>${RSS_LANGUAGE}</language>
    <lastBuildDate>${buildDate}</lastBuildDate>
    <itunes:category text="${escapeXml(RSS_CATEGORY)}" />
${items}
  </channel>
</rss>`;

    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    return res.send(xml);
  } catch (e) {
    console.error('rss feed error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Feed endpoints
app.get('/feed/:channel/:week/:day/playlist', authMiddleware, async (req, res) => {
  const { channel, week, day } = req.params;
  const withUrls = String(req.query.withUrls || '').toLowerCase() === '1' || String(req.query.withUrls || '').toLowerCase() === 'true';
  try {
    const client = await pool.connect();
    try {
      const sched = await client.query('select id, playback_mode, play_start from schedules where channel=$1 and week=$2 and day=$3', [channel, week, day]);
      if (!sched.rows.length) return res.json({ playbackMode: 'loop', playStart: '00:00', items: [] });
      const row = sched.rows[0];
      const items = await client.query(`
        select si.position, a.id as asset_id, a.vimeo_reference, a.duration_sec, a.s3_key, a.s3_key_norm, a.norm_status
        from schedule_items si
        join assets a on a.id = si.asset_id
        where si.schedule_id=$1
        order by si.position asc
      `, [row.id]);
      const base = items.rows.map(r => ({ assetId: r.asset_id, vimeoId: r.vimeo_reference, durationSec: r.duration_sec || 0, s3Key: r.s3_key, s3KeyNorm: r.s3_key_norm, normStatus: r.norm_status }));
      if (withUrls && hasS3) {
        const enriched = await Promise.all(base.map(async (it) => {
          try {
            const useNormalized = it.s3KeyNorm && it.normStatus === 'ready';
            const key = useNormalized ? it.s3KeyNorm : it.s3Key;
            const cmd = new GetObjectCommand({ Bucket: process.env.S3_BUCKET_UPLOADS, Key: key });
            const url = await getSignedUrl(s3, cmd, { expiresIn: (parseInt(process.env.PRESIGN_TTL_MINUTES || '10', 10)) * 60 });
            // Playlist item resolved
            return { assetId: it.assetId, vimeoId: it.vimeoId, durationSec: it.durationSec, url, normalized: useNormalized, normStatus: it.normStatus };
          } catch {
            return { assetId: it.assetId, vimeoId: it.vimeoId, durationSec: it.durationSec, normStatus: it.normStatus };
          }
        }));
        return res.json({ playbackMode: row.playback_mode || 'loop', playStart: row.play_start || '00:00', items: enriched });
      }
      return res.json({ playbackMode: row.playback_mode || 'loop', playStart: row.play_start || '00:00', items: base.map(({ s3Key, s3KeyNorm, ...rest }) => rest) });
    } finally { client.release(); }
  } catch (e) {
    console.error('feed playlist error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Admin role check middleware
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin' && req.user?.role !== 'service') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
}

// Admin: enqueue backfill normalization for existing assets
app.post('/admin/normalize/backfill', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(`select id from assets where coalesce(s3_key_norm,'')=''`);
    const client = await pool.connect();
    try {
      await client.query('begin');
      for (const r of rows) {
        await client.query(`insert into normalize_jobs (asset_id, status) values ($1,'pending') on conflict do nothing`, [r.id]);
        await client.query(`update assets set norm_status='pending' where id=$1`, [r.id]);
      }
      await client.query('commit');
    } catch (e) {
      try { await client.query('rollback'); } catch (rbErr) { console.error('rollback failed', rbErr.message); }
      throw e;
    } finally { client.release(); }
    return res.json({ enqueued: rows.length });
  } catch (e) {
    console.error('backfill normalize error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Admin: re-normalize ALL assets (even if already normalized)
app.post('/admin/normalize/reprocess', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(`select id from assets where file_type = 'video' order by uploaded_at desc`);
    const client = await pool.connect();
    try {
      await client.query('begin');
      for (const r of rows) {
        // Delete existing job if any, then create new one
        await client.query(`delete from normalize_jobs where asset_id=$1`, [r.id]);
        await client.query(`insert into normalize_jobs (asset_id, status) values ($1,'pending')`, [r.id]);
        await client.query(`update assets set norm_status='pending' where id=$1`, [r.id]);
      }
      await client.query('commit');
    } catch (e) {
      try { await client.query('rollback'); } catch (rbErr) { console.error('rollback failed', rbErr.message); }
      throw e;
    } finally { client.release(); }
    console.log(`==> Enqueued ${rows.length} assets for re-normalization`);
    return res.json({ enqueued: rows.length, message: 'All video assets enqueued for re-normalization' });
  } catch (e) {
    console.error('reprocess normalize error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Debug: Check normalization status
app.get('/debug/normalized', authMiddleware, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      select id, file_name, norm_status, s3_key_norm
      from assets
      order by uploaded_at desc
    `);
    return res.json({ assets: rows });
  } catch (e) {
    console.error('debug normalized error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Debug schedule status: which items exist in assets table and which are missing
app.get('/debug/schedule/:channel/:week/:day', authMiddleware, async (req, res) => {
  const { channel, week, day } = req.params;
  try {
    const client = await pool.connect();
    try {
      const sched = await client.query('select id from schedules where channel=$1 and week=$2 and day=$3', [channel, week, day]);
      if (!sched.rows.length) return res.json({ scheduleItems: [], assetsFound: [], assetsMissing: [] });
      const sid = sched.rows[0].id;
      const items = await client.query('select asset_id from schedule_items where schedule_id=$1 order by position asc', [sid]);
      const ids = items.rows.map(r => r.asset_id);
      const assets = await client.query('select id, s3_key from assets where id = any($1)', [ids]);
      const foundSet = new Set(assets.rows.map(r => r.id));
      const assetsFound = assets.rows.map(r => ({ id: r.id, hasKey: !!r.s3_key }));
      const assetsMissing = ids.filter(id => !foundSet.has(id));
      return res.json({ scheduleItems: ids, assetsFound, assetsMissing });
    } finally { client.release(); }
  } catch (e) {
    console.error('debug schedule error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.get('/feed/:channel/:week/:day/now', authMiddleware, async (req, res) => {
  const { channel, week, day } = req.params;
  const at = req.query.at ? new Date(req.query.at) : new Date();
  if (isNaN(at.getTime())) return res.status(400).json({ message: 'Invalid date' });
  try {
    const client = await pool.connect();
    try {
      const sched = await client.query('select id, playback_mode, play_start from schedules where channel=$1 and week=$2 and day=$3', [channel, week, day]);
      if (!sched.rows.length) return res.json({ index: 0, offsetSec: 0 });
      const row = sched.rows[0];
      const items = await client.query('select a.duration_sec from schedule_items si join assets a on a.id = si.asset_id where si.schedule_id=$1 order by si.position asc', [row.id]);
      const durations = items.rows.map(r => Number(r.duration_sec || 0));
      const ptr = computePointer(row.playback_mode || 'loop', row.play_start || '00:00', durations, at);
      return res.json(ptr);
    } finally { client.release(); }
  } catch (e) {
    console.error('feed now error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Status endpoints (current pointer + item meta)
function dayNameFor(date = new Date()) {
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][date.getDay()];
}

app.get('/status/:channel/:week/today', authMiddleware, async (req, res) => {
  req.params.day = dayNameFor();
  // Fall through to the /:day handler below via redirect
  return res.redirect(307, `/status/${encodeURIComponent(req.params.channel)}/${encodeURIComponent(req.params.week)}/${req.params.day}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`);
});

app.get('/status/:channel/:week/:day', authMiddleware, async (req, res) => {
  const { channel, week, day } = req.params;
  const at = req.query.at ? new Date(req.query.at) : new Date();
  if (isNaN(at.getTime())) return res.status(400).json({ message: 'Invalid date' });
  try {
    const client = await pool.connect();
    try {
      const sched = await client.query('select id, playback_mode, play_start from schedules where channel=$1 and week=$2 and day=$3', [channel, week, day]);
      if (!sched.rows.length) return res.json({ day, index: 0, offsetSec: 0 });
      const row = sched.rows[0];
      const items = await client.query('select a.id, a.file_name, a.duration_sec, a.vimeo_reference, a.category_id from schedule_items si join assets a on a.id = si.asset_id where si.schedule_id=$1 order by si.position asc', [row.id]);
      const durations = items.rows.map(r => Number(r.duration_sec || 0));
      const ptr = computePointer(row.playback_mode || 'loop', row.play_start || '00:00', durations, at);
      const idx = Math.max(0, Math.min(items.rows.length - 1, ptr.index || 0));
      const current = items.rows[idx] || null;
      return res.json({
        day,
        index: ptr.index || 0,
        offsetSec: ptr.offsetSec || 0,
        ended: !!ptr.ended,
        item: current ? {
          assetId: current.id,
          name: current.file_name,
          durationSec: current.duration_sec || 0,
          vimeoReference: current.vimeo_reference,
          categoryId: current.category_id,
        } : null,
      });
    } finally { client.release(); }
  } catch (e) {
    console.error('status error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Relay proxy endpoints (to avoid CORS issues)
const RELAY_URL = process.env.RELAY_URL || '';

app.get('/api/relay/status', async (req, res) => {
  if (!RELAY_URL) {
    return res.json({ streaming: false, available: false });
  }
  try {
    const response = await fetch(`${RELAY_URL}/api/status`, { timeout: 3000 });
    if (!response.ok) throw new Error(`Relay status: ${response.status}`);
    const data = await response.json();
    res.json({ ...data, available: true });
  } catch (e) {
    console.warn('Relay status check failed:', e.message);
    res.json({ streaming: false, available: false });
  }
});

app.get('/api/relay/destinations', async (req, res) => {
  if (!RELAY_URL) {
    return res.json({ destinations: [] });
  }
  try {
    const response = await fetch(`${RELAY_URL}/api/destinations`, { timeout: 3000 });
    if (!response.ok) throw new Error(`Relay destinations: ${response.status}`);
    const data = await response.json();
    res.json(data);
  } catch (e) {
    console.warn('Relay destinations check failed:', e.message);
    res.json({ destinations: [] });
  }
});

app.get('/api/relay/healthz', async (req, res) => {
  if (!RELAY_URL) {
    return res.json({ available: false, error: 'RELAY_URL not configured' });
  }
  try {
    const response = await fetch(`${RELAY_URL}/healthz`, { timeout: 3000 });
    if (!response.ok) throw new Error(`Relay health: ${response.status}`);
    res.json({ available: true, url: RELAY_URL });
  } catch (e) {
    console.warn('Relay health check failed:', e.message);
    res.json({ available: false, error: 'Relay unreachable' });
  }
});

// System status endpoint - checks all services in order
app.get('/api/system/status', async (req, res) => {
  const status = {
    timestamp: new Date().toISOString(),
    services: []
  };

  // 1. Backend (always online if responding)
  status.services.push({
    name: 'Backend API',
    status: 'online',
    message: 'Responding'
  });

  // 2. Database
  try {
    await pool.query('SELECT 1');
    status.services.push({
      name: 'Database',
      status: 'online',
      message: 'Connected'
    });
  } catch (e) {
    status.services.push({
      name: 'Database',
      status: 'error',
      message: 'Connection failed'
    });
  }

  // 3. Relay Service
  if (!RELAY_URL) {
    status.services.push({
      name: 'Relay Service',
      status: 'offline',
      message: 'Not configured'
    });
  } else {
    try {
      const healthRes = await fetch(`${RELAY_URL}/healthz`, { timeout: 3000 });
      if (healthRes.ok) {
        status.services.push({
          name: 'Relay Service',
          status: 'online',
          message: 'Healthy'
        });
      } else {
        status.services.push({
          name: 'Relay Service',
          status: 'error',
          message: `HTTP ${healthRes.status}`
        });
      }
    } catch (e) {
      status.services.push({
        name: 'Relay Service',
        status: 'offline',
        message: 'Unreachable'
      });
    }
  }

  // 4. Streamer Service
  const STREAMER_URL = process.env.STREAMER_URL || '';
  if (!STREAMER_URL) {
    status.services.push({
      name: 'Streamer Service',
      status: 'offline',
      message: 'Not configured'
    });
  } else {
    try {
      // Check /status endpoint for detailed info (includes running state)
      const streamerRes = await fetch(`${STREAMER_URL}/status`, { timeout: 3000 });
      if (streamerRes.ok) {
        const streamerData = await streamerRes.json();
        status.services.push({
          name: 'Streamer Service',
          status: 'online',
          message: streamerData.running ? 'Streaming' : 'Ready'
        });
      } else {
        status.services.push({
          name: 'Streamer Service',
          status: 'error',
          message: `HTTP ${streamerRes.status}`
        });
      }
    } catch (e) {
      status.services.push({
        name: 'Streamer Service',
        status: 'offline',
        message: 'Unreachable'
      });
    }
  }

  // 5. HLS Stream (check if relay is receiving and generating segments)
  if (RELAY_URL) {
    try {
      const statusRes = await fetch(`${RELAY_URL}/api/status`, { timeout: 3000 });
      const statusData = await statusRes.json();

      if (statusData.streaming) {
        // Verify HLS manifest exists
        try {
          const hlsRes = await fetch(`${RELAY_URL}/hls/stream.m3u8`, { timeout: 3000 });
          if (hlsRes.ok) {
            const text = await hlsRes.text();
            if (text.includes('#EXTM3U')) {
              status.services.push({
                name: 'HLS Stream',
                status: 'online',
                message: 'Live segments available'
              });
            } else {
              status.services.push({
                name: 'HLS Stream',
                status: 'error',
                message: 'Invalid manifest'
              });
            }
          } else {
            status.services.push({
              name: 'HLS Stream',
              status: 'error',
              message: 'Manifest not found'
            });
          }
        } catch (e) {
          status.services.push({
            name: 'HLS Stream',
            status: 'error',
            message: 'Manifest check failed'
          });
        }
      } else {
        status.services.push({
          name: 'HLS Stream',
          status: 'offline',
          message: 'Not streaming'
        });
      }
    } catch (e) {
      status.services.push({
        name: 'HLS Stream',
        status: 'unknown',
        message: 'Status unknown'
      });
    }
  } else {
    status.services.push({
      name: 'HLS Stream',
      status: 'offline',
      message: 'Relay not configured'
    });
  }

  // 6. YouTube Push
  if (RELAY_URL) {
    try {
      const destRes = await fetch(`${RELAY_URL}/api/destinations`, { timeout: 3000 });
      const destData = await destRes.json();

      if (destData.destinations && destData.destinations.includes('youtube')) {
        status.services.push({
          name: 'YouTube Push',
          status: 'online',
          message: 'Configured and pushing'
        });
      } else {
        status.services.push({
          name: 'YouTube Push',
          status: 'offline',
          message: 'Not configured'
        });
      }
    } catch (e) {
      status.services.push({
        name: 'YouTube Push',
        status: 'unknown',
        message: 'Status unknown'
      });
    }
  } else {
    status.services.push({
      name: 'YouTube Push',
      status: 'offline',
      message: 'Relay not configured'
    });
  }

  res.json(status);
});

// Legacy debug endpoint (kept for compatibility)
app.get('/api/debug/on-air', authMiddleware, async (req, res) => {
  const checks = {
    relayConfigured: !!RELAY_URL,
    relayUrl: RELAY_URL || 'Not configured',
    timestamp: new Date().toISOString()
  };

  // Check relay status
  if (RELAY_URL) {
    try {
      const statusRes = await fetch(`${RELAY_URL}/api/status`, { timeout: 3000 });
      const statusData = await statusRes.json();
      checks.relayStatus = statusData;
    } catch (e) {
      checks.relayStatus = { error: 'Unreachable' };
    }

    try {
      const destRes = await fetch(`${RELAY_URL}/api/destinations`, { timeout: 3000 });
      const destData = await destRes.json();
      checks.relayDestinations = destData;
    } catch (e) {
      checks.relayDestinations = { error: 'Unreachable' };
    }
  }

  res.json(checks);
});

// HTTP server + WebSocket
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const subs = new Map(); // topic -> Set(ws)
const MAX_TOPICS_PER_CLIENT = 20;
// `categories` and `stream-actions` are exact-match topics; only `schedule:` is a
// prefix namespace (schedule:<channel>:<week>:<day>). Exact-matching the first two
// stops a client from registering arbitrary keys like "categories-attacker".
const EXACT_TOPICS = new Set(['categories', 'stream-actions']);
const SCHEDULE_TOPIC_RE = /^schedule:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/;
function isAllowedTopic(topic) {
  if (typeof topic !== 'string') return false;
  if (EXACT_TOPICS.has(topic)) return true;
  return SCHEDULE_TOPIC_RE.test(topic);
}

wss.on('connection', (ws, req) => {
  // Require a valid JWT or the service token on the WS handshake. Realtime carries
  // every schedule/category mutation, so an unauthenticated subscriber would be an
  // information leak. Reject up front rather than silently accepting.
  let authenticated = false;
  try {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    if (token) {
      jwt.verify(token, _JWT_SECRET, { algorithms: ['HS256'] });
      authenticated = true;
    } else if (SERVICE_TOKEN) {
      const svc = url.searchParams.get('service_token');
      if (svc && String(svc) === String(SERVICE_TOKEN)) authenticated = true;
    }
  } catch {}

  if (!authenticated) {
    try { ws.close(1008, 'Unauthorized'); } catch {}
    return;
  }

  let clientTopicCount = 0;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg?.type === 'subscribe' && msg.topic) {
        // Validate topic against the strict allowlist
        if (!isAllowedTopic(msg.topic)) return;
        // Limit topics per client
        if (clientTopicCount >= MAX_TOPICS_PER_CLIENT) return;
        if (!subs.has(msg.topic)) subs.set(msg.topic, new Set());
        subs.get(msg.topic).add(ws);
        clientTopicCount++;
      } else if (msg?.type === 'unsubscribe' && msg.topic) {
        if (subs.get(msg.topic)?.delete(ws)) clientTopicCount--;
      }
    } catch (e) {
      console.warn('Invalid WebSocket message:', e.message);
    }
  });
  ws.on('close', () => {
    for (const set of subs.values()) set.delete(ws);
  });
});

function broadcast(topic, payload) {
  const set = subs.get(topic);
  if (!set) return;
  const data = JSON.stringify({ topic, ...payload });
  for (const ws of set) {
    try { ws.send(data); } catch (e) {
      // Remove dead connections
      set.delete(ws);
    }
  }
}

// Seed admin user from env vars if not exists
async function seedAdminUser() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.log('[Seed] No ADMIN_EMAIL/ADMIN_PASSWORD env vars set, skipping admin seed');
    return;
  }
  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (rows.length > 0) {
      console.log(`[Seed] Admin user ${email} already exists`);
      return;
    }
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (id, email, password_hash, role) VALUES (gen_random_uuid(), $1, $2, $3)',
      [email, hash, 'admin']
    );
    console.log(`[Seed] Created admin user: ${email}`);
  } catch (e) {
    console.error('[Seed] Failed to seed admin user:', e.message);
  }
}

const port = process.env.PORT || 3000;
server.listen(port, async () => {
  console.log(`ralphTV backend listening on ${port}`);
  await seedAdminUser();
});

// Graceful shutdown
async function shutdown(signal) {
  console.log(`\n[Shutdown] Received ${signal}, closing gracefully...`);
  server.close(() => {
    console.log('[Shutdown] HTTP server closed');
  });
  for (const ws of wss.clients) {
    try { ws.close(1001, 'Server shutting down'); } catch {}
  }
  try { await pool.end(); console.log('[Shutdown] Database pool closed'); } catch {}
  setTimeout(() => process.exit(0), 5000); // Force exit after 5s
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
