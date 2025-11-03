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
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// S3 client if env present
const hasS3 = !!(process.env.AWS_REGION && process.env.S3_BUCKET_UPLOADS);
const s3 = hasS3
  ? new S3Client({ region: process.env.AWS_REGION })
  : null;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const SERVICE_TOKEN = process.env.SERVICE_TOKEN || '';

// Health
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Auth helpers
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });
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
    const decoded = jwt.verify(bearer, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
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
app.post('/uploads/init', authMiddleware, async (req, res) => {
  const { fileName, mimeType, size } = req.body || {};
  if (!fileName || !mimeType || typeof size !== 'number') return res.status(400).json({ message: 'Missing fields' });
  if (!hasS3) return res.status(501).json({ message: 'S3 not configured' });

  try {
    const fileId = uuidv4();
    const keyPrefix = process.env.S3_PREFIX || 'raw';
    const userPrefix = req.user?.userId || 'anon';
    const s3Key = `${keyPrefix}/${userPrefix}/${fileId}/${fileName}`;

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

app.post('/uploads/complete', authMiddleware, async (req, res) => {
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
app.get('/uploads/part-url', authMiddleware, async (req, res) => {
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

app.put('/schedule/:channel/:week/:day', authMiddleware, async (req, res) => {
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
      await pool.query('rollback');
      throw e;
    } finally { client.release(); }
  } catch (e) {
    console.error('schedule put error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.patch('/schedule/:channel/:week/:day', authMiddleware, async (req, res) => {
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
      await pool.query('rollback');
      throw e;
    } finally { client.release(); }
  } catch (e) {
    console.error('schedule patch error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Tags endpoint
app.post('/assets/:id/tags', authMiddleware, async (req, res) => {
  const assetId = req.params.id;
  const { tags } = req.body || {};
  if (!Array.isArray(tags)) return res.status(400).json({ message: 'Invalid tags' });
  try {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const ids = [];
      for (const name of tags) {
        const { rows } = await client.query('insert into tags (id, name) values (gen_random_uuid(), $1) on conflict (name) do update set name=excluded.name returning id', [name]);
        ids.push(rows[0].id);
      }
      await client.query('delete from asset_tags where asset_id=$1', [assetId]);
      for (const tid of ids) {
        await client.query('insert into asset_tags (asset_id, tag_id) values ($1, $2) on conflict do nothing', [assetId, tid]);
      }
      await client.query('commit');
      return res.json({ ok: true, tags });
    } catch (e) {
      await pool.query('rollback');
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

app.post('/categories', authMiddleware, async (req, res) => {
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

app.patch('/categories/:id', authMiddleware, async (req, res) => {
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

app.delete('/categories/:id', authMiddleware, async (req, res) => {
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
app.post('/assets/:id/category', authMiddleware, async (req, res) => {
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
      select a.id, a.file_name, a.mime_type, a.size, a.s3_key, a.file_type, a.uploaded_at, a.vimeo_reference, a.duration_sec, a.thumbnail_url, a.category_id,
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
    const { rows } = await pool.query('select s3_key, mime_type from assets where id=$1', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Not found' });
    const key = rows[0].s3_key;
    const cmd = new GetObjectCommand({ Bucket: process.env.S3_BUCKET_UPLOADS, Key: key });
    const url = await getSignedUrl(s3, cmd, { expiresIn: (parseInt(process.env.PRESIGN_TTL_MINUTES || '10', 10)) * 60 });
    return res.json({ url });
  } catch (e) {
    console.error('asset url error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Update duration
app.post('/assets/:id/duration', authMiddleware, async (req, res) => {
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
            const key = it.s3KeyNorm && it.normStatus === 'ready' ? it.s3KeyNorm : it.s3Key;
            const cmd = new GetObjectCommand({ Bucket: process.env.S3_BUCKET_UPLOADS, Key: key });
            const url = await getSignedUrl(s3, cmd, { expiresIn: (parseInt(process.env.PRESIGN_TTL_MINUTES || '10', 10)) * 60 });
            return { assetId: it.assetId, vimeoId: it.vimeoId, durationSec: it.durationSec, url };
          } catch {
            return { assetId: it.assetId, vimeoId: it.vimeoId, durationSec: it.durationSec };
          }
        }));
        return res.json({ playbackMode: row.playback_mode || 'loop', playStart: row.play_start || '00:00', items: enriched });
      }
      return res.json({ playbackMode: row.playback_mode || 'loop', playStart: row.play_start || '00:00', items: base.map(({ s3Key, s3KeyNorm, normStatus, ...rest }) => rest) });
    } finally { client.release(); }
  } catch (e) {
    console.error('feed playlist error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Admin: enqueue backfill normalization for existing assets
app.post('/admin/normalize/backfill', authMiddleware, async (req, res) => {
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
      await client.query('rollback');
      throw e;
    } finally { client.release(); }
    return res.json({ enqueued: rows.length });
  } catch (e) {
    console.error('backfill normalize error', e);
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
  const day = dayNameFor();
  const { channel, week } = req.params;
  req.params.day = day;
  return app._router.handle({ ...req, url: `/status/${encodeURIComponent(channel)}/${encodeURIComponent(week)}/${day}` }, res, () => {});
});

app.get('/status/:channel/:week/:day', authMiddleware, async (req, res) => {
  const { channel, week, day } = req.params;
  const at = req.query.at ? new Date(req.query.at) : new Date();
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

// HTTP server + WebSocket
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const subs = new Map(); // topic -> Set(ws)
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg?.type === 'subscribe' && msg.topic) {
        if (!subs.has(msg.topic)) subs.set(msg.topic, new Set());
        subs.get(msg.topic).add(ws);
      } else if (msg?.type === 'unsubscribe' && msg.topic) {
        subs.get(msg.topic)?.delete(ws);
      }
    } catch {}
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
    try { ws.send(data); } catch {}
  }
}

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`ralphTV backend listening on ${port}`));
