import 'dotenv/config';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

console.log('==> Transcoder starting...');

// Fail fast on missing required env vars
const REQUIRED_ENV = ['DATABASE_URL', 'AWS_REGION', 'S3_BUCKET_UPLOADS'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`FATAL: Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('==> DATABASE_URL:', 'set');
console.log('==> AWS_REGION:', process.env.AWS_REGION);
console.log('==> S3_BUCKET_UPLOADS:', process.env.S3_BUCKET_UPLOADS);
console.log('==> AWS_ACCESS_KEY_ID:', process.env.AWS_ACCESS_KEY_ID ? 'set' : 'MISSING');

const isLocalDb = (process.env.DATABASE_URL || '').includes('localhost') || (process.env.DATABASE_URL || '').includes('127.0.0.1');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway Postgres uses self-signed certs — require SSL but don't verify the chain.
  // (Previously this was `=== 'production'`, which rejected Railway's cert in prod.)
  ...(isLocalDb ? {} : { ssl: { rejectUnauthorized: false } }),
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
const s3 = new S3Client({ region: process.env.AWS_REGION });
const BUCKET = process.env.S3_BUCKET_UPLOADS;
const TARGET_W = parseInt(process.env.TARGET_WIDTH || '1280', 10);
const TARGET_H = parseInt(process.env.TARGET_HEIGHT || '720', 10);
const FPS = parseInt(process.env.FPS || '24', 10);
const GOP = parseInt(process.env.GOP || String(FPS), 10); // 1 second GOP for short videos
const VBIT = process.env.VIDEO_BITRATE || '2500k';
const ABIT = process.env.AUDIO_BITRATE || '160k';
const PRESET = process.env.PRESET || 'ultrafast';

// Job-lifecycle tuning
const MAX_ATTEMPTS = parseInt(process.env.MAX_NORMALIZE_ATTEMPTS || '5', 10); // give up after N tries
const RETRY_BACKOFF_MIN = parseInt(process.env.RETRY_BACKOFF_MINUTES || '1', 10); // wait before retrying a failed job
const STUCK_JOB_MIN = parseInt(process.env.STUCK_JOB_MINUTES || '15', 10); // reclaim 'processing' jobs orphaned by a dead worker

// Tracks the in-flight ffmpeg child so SIGTERM can kill it instead of orphaning it.
let currentChild = null;
let shuttingDown = false;

console.log('==> Config: Resolution:', `${TARGET_W}x${TARGET_H}`, 'FPS:', FPS, 'GOP:', GOP, 'Bitrate:', VBIT, 'Preset:', PRESET);
console.log('==> Job tuning: maxAttempts:', MAX_ATTEMPTS, 'retryBackoffMin:', RETRY_BACKOFF_MIN, 'stuckJobMin:', STUCK_JOB_MIN);

async function nextJob() {
  // Atomic claim: the subselect locks exactly one eligible row with FOR UPDATE SKIP
  // LOCKED so concurrent transcoders never grab the same job (no double-encode).
  // Eligible = pending, OR failed-but-under-the-retry-cap after a backoff window, OR
  // stuck in 'processing' past STUCK_JOB_MIN (a previous worker died mid-job) and
  // still under the cap. Anything that hit MAX_ATTEMPTS stays failed for good.
  const { rows } = await pool.query(
    `update normalize_jobs
        set status='processing', attempts=attempts+1, updated_at=now()
      where id = (
        select id from normalize_jobs
         where status='pending'
            or (status='failed'     and attempts < $1 and updated_at < now() - make_interval(mins => $2))
            or (status='processing' and attempts < $1 and updated_at < now() - make_interval(mins => $3))
         order by created_at asc
         limit 1
         for update skip locked
      )
      returning id, asset_id, attempts`,
    [MAX_ATTEMPTS, RETRY_BACKOFF_MIN, STUCK_JOB_MIN]
  );
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
    currentChild = p;
    // Keep only the tail of stderr — a long transcode can emit many MB of logs.
    let stderr = '';
    const STDERR_CAP = 32 * 1024;
    p.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > STDERR_CAP) stderr = stderr.slice(-STDERR_CAP);
    });
    p.on('error', (err) => { currentChild = null; reject(err); });
    p.on('exit', (code, signal) => {
      currentChild = null;
      if (code !== 0) {
        console.error('==> ffmpeg stderr:', stderr);
        reject(new Error(`ffmpeg exit ${code}${signal ? ` (signal ${signal})` : ''}`));
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
  // Stream from disk with a known ContentLength instead of fs.readFile, so a large
  // normalized file isn't loaded entirely into memory (was an OOM risk on Railway).
  const { size } = await fs.stat(filePath);
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: createReadStream(filePath),
    ContentLength: size,
    ContentType: 'video/mp4',
  }));
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
  while (!shuttingDown) {
    let job = null;
    let src = null;
    let out = null;
    try {
      pollCount++;
      lastPollAt = Date.now();
      if (pollCount % 10 === 1) {
        console.log(`==> Poll #${pollCount}: Checking for pending jobs...`);
      }
      job = await nextJob();
      if (!job) {
        // No job found — backoff: 2s initially, up to 10s after 10 empty polls
        if (pollCount === 1) {
          console.log('==> No jobs found on first poll. Waiting for jobs...');
        }
        const idleDelay = Math.min(2000 + (pollCount * 200), 10000);
        await new Promise(r => setTimeout(r, idleDelay));
        continue;
      }
      console.log(`==> Processing job ${job.id} for asset ${job.asset_id} (attempt ${job.attempts}/${MAX_ATTEMPTS})`);
      const asset = await getAsset(job.asset_id);
      if (!asset || !asset.s3_key) {
        console.log(`==> Asset ${job.asset_id} not found or missing s3_key, marking job done`);
        await doneJob(job.id);
        job = null; // handled — don't fail it in catch
        continue;
      }
      console.log(`==> Downloading ${asset.s3_key}...`);
      await pool.query('update assets set norm_status=$2 where id=$1', [job.asset_id, 'processing']);
      src = await downloadToTmp(asset.s3_key);
      console.log(`==> Normalizing to ${TARGET_W}x${TARGET_H} @ ${FPS}fps...`);
      out = await normalize(src);
      console.log(`==> Uploading normalized file...`);
      await uploadNorm(job.asset_id, out);
      await doneJob(job.id);
      console.log(`==> Job ${job.id} completed successfully!`);
      pollCount = 0; // Reset after successful job
    } catch (e) {
      console.error('==> Transcoder error:', e?.message || e);
      // Record the failure so the job doesn't sit in 'processing' forever. nextJob
      // will retry it (after backoff) until MAX_ATTEMPTS, then leave it failed.
      if (job) {
        try { await failJob(job.id, job.asset_id, e); }
        catch (fe) { console.error('==> Failed to record job failure:', fe?.message || fe); }
      }
      await new Promise(r => setTimeout(r, 2000));
    } finally {
      // Always clean up temp files, even on failure, so /tmp can't fill and crash-loop.
      if (src) { try { await fs.unlink(src); } catch {} }
      if (out) { try { await fs.unlink(out); } catch {} }
    }
  }
  console.log('==> Worker loop stopped (shutting down)');
}

// Health check endpoint
import http from 'node:http';
const healthPort = process.env.PORT || 3002;
let lastPollAt = Date.now();

const healthServer = http.createServer((req, res) => {
  if (req.url === '/healthz' || req.url === '/') {
    const stale = Date.now() - lastPollAt > 30000; // 30s without poll = unhealthy
    res.writeHead(stale ? 503 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: !stale, lastPollAt: new Date(lastPollAt).toISOString() }));
  } else {
    res.writeHead(404);
    res.end('not found');
  }
});
healthServer.listen(healthPort, () => console.log(`==> Transcoder health on :${healthPort}`));

// Graceful shutdown — stop claiming new jobs, kill any in-flight ffmpeg (so it isn't
// orphaned), then close resources. The current job, if interrupted, is left in
// 'processing' and will be reclaimed by the stuck-job reaper on the next worker.
async function shutdown(signal) {
  console.log(`\n==> Received ${signal}, shutting down...`);
  shuttingDown = true;
  if (currentChild) {
    try { currentChild.kill('SIGTERM'); } catch {}
    // Escalate if ffmpeg doesn't exit promptly.
    setTimeout(() => { try { currentChild?.kill('SIGKILL'); } catch {} }, 5000).unref();
  }
  try { await pool.end(); } catch {}
  try { healthServer.close(); } catch {}
  setTimeout(() => process.exit(0), 6000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log('==> Starting worker loop...');
loop();

