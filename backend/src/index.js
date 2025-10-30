import 'dotenv/config';
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
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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

// Health
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Auth helpers
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });
}

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(403).json({ message: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
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
  const { fileId, uploadId, parts, s3Key, fileName, mimeType, size } = req.body || {};
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
        `insert into assets (id, file_name, mime_type, size, s3_key, file_type)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (id) do nothing`,
        [fileId, fileName, mimeType, size, s3Key, fileType]
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
      return res.json({ version: schedRow.version, items });
    } finally { client.release(); }
  } catch (e) {
    console.error('schedule get error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.put('/schedule/:channel/:week/:day', authMiddleware, async (req, res) => {
  const { channel, week, day } = req.params;
  const { items } = req.body || {};
  const ifMatch = parseInt(req.headers['if-match'] || '0', 10) || 0;
  if (!Array.isArray(items)) return res.status(400).json({ message: 'Invalid items' });
  try {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const schedRow = await getOrCreateScheduleId(client, channel, week, day);
      const updated = await client.query('update schedules set version = version + 1, updated_at = now() where id=$1 and version=$2 returning version', [schedRow.id, ifMatch]);
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
      const newVersion = updated.rows[0].version;
      await client.query('commit');
      return res.json({ version: newVersion, items });
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
  const { ops } = req.body || {};
  const ifMatch = parseInt(req.headers['if-match'] || '0', 10) || 0;
  if (!Array.isArray(ops)) return res.status(400).json({ message: 'Invalid ops' });
  try {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const schedRow = await getOrCreateScheduleId(client, channel, week, day);
      const updated = await client.query('update schedules set version = version + 1, updated_at = now() where id=$1 and version=$2 returning version', [schedRow.id, ifMatch]);
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
      const newVersion = updated.rows[0].version;
      await client.query('commit');
      return res.json({ version: newVersion, items });
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

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`ralphTV backend listening on ${port}`));
