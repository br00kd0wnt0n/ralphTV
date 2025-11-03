import 'dotenv/config';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const s3 = new S3Client({ region: process.env.AWS_REGION });
const BUCKET = process.env.S3_BUCKET_UPLOADS;
const TARGET_W = parseInt(process.env.TARGET_WIDTH || '1920', 10);
const TARGET_H = parseInt(process.env.TARGET_HEIGHT || '1080', 10);
const FPS = parseInt(process.env.FPS || '30', 10);
const GOP = parseInt(process.env.GOP || String(FPS * 2), 10);
const VBIT = process.env.VIDEO_BITRATE || '4500k';
const ABIT = process.env.AUDIO_BITRATE || '160k';

async function nextJob() {
  const { rows } = await pool.query(`
    update normalize_jobs set status='processing', attempts=attempts+1, updated_at=now()
    where id in (
      select id from normalize_jobs where status in ('pending','failed') order by created_at asc limit 1
    )
    returning id, asset_id, attempts
  `);
  return rows[0] || null;
}

async function getAsset(assetId) {
  const { rows } = await pool.query('select id, s3_key from assets where id=$1', [assetId]);
  return rows[0] || null;
}

async function downloadToTmp(key) {
  const tmp = path.join(os.tmpdir(), `ralphtv_trans_${Date.now()}.mp4`);
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const stream = res.Body;
  const file = await fs.open(tmp, 'w');
  const writer = file.createWriteStream();
  await new Promise((resolve, reject) => {
    stream.on('error', reject);
    writer.on('error', reject);
    writer.on('close', resolve);
    stream.pipe(writer);
  });
  await file.close();
  return tmp;
}

async function normalize(inPath) {
  const out = path.join(os.tmpdir(), `ralphtv_norm_${Date.now()}.mp4`);
  const args = [
    '-loglevel', 'error',
    '-i', inPath,
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-b:v', VBIT, '-maxrate', VBIT, '-bufsize', '10000k',
    '-g', String(GOP), '-r', String(FPS), '-vf', `scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=decrease,pad=${TARGET_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2:color=black`,
    '-c:a', 'aac', '-b:a', ABIT, '-ar', '48000', '-ac', '2', '-movflags', '+faststart', out,
  ];
  await new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    p.on('error', reject);
    p.on('exit', (code) => code === 0 ? resolve() : reject(new Error('ffmpeg exit ' + code)));
  });
  return out;
}

async function uploadNorm(assetId, filePath) {
  const key = `normalized/${assetId}.mp4`;
  const body = await fs.readFile(filePath);
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: 'video/mp4' }));
  await pool.query('update assets set s3_key_norm=$2, norm_status=$3, norm_error=null where id=$1', [assetId, key, 'ready']);
  return key;
}

async function failJob(jobId, assetId, err) {
  await pool.query('update normalize_jobs set status=$2, last_error=$3, updated_at=now() where id=$1', [jobId, 'failed', String(err?.message || err)]);
  await pool.query('update assets set norm_status=$2, norm_error=$3 where id=$1', [assetId, 'failed', String(err?.message || err)]);
}

async function doneJob(jobId) {
  await pool.query('update normalize_jobs set status=$2, updated_at=now() where id=$1', [jobId, 'done']);
}

async function loop() {
  while (true) {
    try {
      const job = await nextJob();
      if (!job) { await new Promise(r => setTimeout(r, 2000)); continue; }
      const asset = await getAsset(job.asset_id);
      if (!asset || !asset.s3_key) { await doneJob(job.id); continue; }
      // mark asset processing
      await pool.query('update assets set norm_status=$2 where id=$1', [job.asset_id, 'processing']);
      const src = await downloadToTmp(asset.s3_key);
      const out = await normalize(src);
      await uploadNorm(job.asset_id, out);
      await doneJob(job.id);
      try { await fs.unlink(src); } catch {}
      try { await fs.unlink(out); } catch {}
    } catch (e) {
      console.error('transcoder error', e);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

loop();

