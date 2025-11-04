import 'dotenv/config';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

console.log('==> Transcoder starting...');
console.log('==> DATABASE_URL:', process.env.DATABASE_URL ? 'set' : 'MISSING');
console.log('==> AWS_REGION:', process.env.AWS_REGION || 'MISSING');
console.log('==> S3_BUCKET_UPLOADS:', process.env.S3_BUCKET_UPLOADS || 'MISSING');
console.log('==> AWS_ACCESS_KEY_ID:', process.env.AWS_ACCESS_KEY_ID ? 'set' : 'MISSING');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const s3 = new S3Client({ region: process.env.AWS_REGION });
const BUCKET = process.env.S3_BUCKET_UPLOADS;
const TARGET_W = parseInt(process.env.TARGET_WIDTH || '1280', 10);
const TARGET_H = parseInt(process.env.TARGET_HEIGHT || '720', 10);
const FPS = parseInt(process.env.FPS || '24', 10);
const GOP = parseInt(process.env.GOP || String(FPS), 10); // 1 second GOP for short videos
const VBIT = process.env.VIDEO_BITRATE || '2500k';
const ABIT = process.env.AUDIO_BITRATE || '160k';
const PRESET = process.env.PRESET || 'ultrafast';

console.log('==> Config: Resolution:', `${TARGET_W}x${TARGET_H}`, 'FPS:', FPS, 'GOP:', GOP, 'Bitrate:', VBIT, 'Preset:', PRESET);

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

async function hasAudioStream(inPath) {
  // Probe the file to check if it has an audio stream
  return new Promise((resolve) => {
    const p = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=codec_type',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inPath
    ]);
    let stdout = '';
    p.stdout.on('data', (d) => { stdout += d.toString(); });
    p.on('exit', (code) => {
      // If we got output and code 0, audio stream exists
      resolve(code === 0 && stdout.trim().length > 0);
    });
    p.on('error', () => resolve(false));
  });
}

async function normalize(inPath) {
  const out = path.join(os.tmpdir(), `ralphtv_norm_${Date.now()}.mp4`);

  // Check if input has audio
  const hasAudio = await hasAudioStream(inPath);
  console.log(`==> Input ${hasAudio ? 'HAS' : 'LACKS'} audio stream`);

  const args = [
    '-loglevel', 'warning',
    '-i', inPath,
  ];

  if (!hasAudio) {
    // Generate silent audio track if no audio in source
    console.log('==> Generating silent audio track for consistency');
    args.push(
      '-f', 'lavfi',
      '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-map', '0:v:0',
      '-map', '1:a:0', // Map audio from the silent source (second input)
      '-shortest' // Stop when video ends
    );
  } else {
    // Use existing audio
    args.push(
      '-map', '0:v:0',
      '-map', '0:a:0'
    );
  }

  // Common encoding settings
  args.push(
    '-c:v', 'libx264', '-preset', PRESET, '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-b:v', VBIT, '-maxrate', VBIT, '-bufsize', '10000k',
    // Exact 1-second keyframes for HLS segmentation (works with short videos)
    '-g', String(GOP),
    '-keyint_min', String(GOP),
    '-sc_threshold', '0',
    '-force_key_frames', 'expr:gte(t,n_forced*1)',
    '-r', String(FPS),
    '-vf', `scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=decrease,pad=${TARGET_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2:color=black`,
    '-c:a', 'aac', '-b:a', ABIT, '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    out
  );

  await new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', reject);
    p.on('exit', (code) => {
      if (code !== 0) {
        console.error('==> ffmpeg stderr:', stderr);
        reject(new Error('ffmpeg exit ' + code));
      } else {
        if (stderr) console.log('==> ffmpeg warnings:', stderr);
        resolve();
      }
    });
  });
  return out;
}

async function uploadNorm(assetId, filePath) {
  const key = `normalized/${assetId}.mp4`;
  const body = await fs.readFile(filePath);
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: 'video/mp4' }));
  await pool.query(
    `update assets set s3_key_norm=$2, norm_status=$3, norm_error=null, norm_width=$4, norm_height=$5, norm_fps=$6, norm_bitrate=$7 where id=$1`,
    [assetId, key, 'ready', TARGET_W, TARGET_H, FPS, parseInt(VBIT.replace('k', ''), 10)]
  );
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
  console.log('==> Worker loop starting, polling for jobs...');
  let pollCount = 0;
  while (true) {
    try {
      pollCount++;
      if (pollCount % 10 === 1) {
        console.log(`==> Poll #${pollCount}: Checking for pending jobs...`);
      }
      const job = await nextJob();
      if (!job) {
        // No job found, wait and retry
        if (pollCount === 1) {
          console.log('==> No jobs found on first poll. Waiting for jobs...');
        }
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      console.log(`==> Processing job ${job.id} for asset ${job.asset_id} (attempt ${job.attempts})`);
      const asset = await getAsset(job.asset_id);
      if (!asset || !asset.s3_key) {
        console.log(`==> Asset ${job.asset_id} not found or missing s3_key, marking job done`);
        await doneJob(job.id);
        continue;
      }
      console.log(`==> Downloading ${asset.s3_key}...`);
      await pool.query('update assets set norm_status=$2 where id=$1', [job.asset_id, 'processing']);
      const src = await downloadToTmp(asset.s3_key);
      console.log(`==> Normalizing to ${TARGET_W}x${TARGET_H} @ ${FPS}fps...`);
      const out = await normalize(src);
      console.log(`==> Uploading normalized file...`);
      await uploadNorm(job.asset_id, out);
      await doneJob(job.id);
      console.log(`==> Job ${job.id} completed successfully!`);
      try { await fs.unlink(src); } catch {}
      try { await fs.unlink(out); } catch {}
      pollCount = 0; // Reset after successful job
    } catch (e) {
      console.error('==> Transcoder error:', e.message);
      console.error('==> Full error:', e);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

console.log('==> Starting worker loop...');
loop();

