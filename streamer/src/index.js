import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CONFIG } from './config.js';

const headers = () => ({
  'Accept': 'application/json',
  ...(CONFIG.API_AUTH_TOKEN ? { 'Authorization': `Bearer ${CONFIG.API_AUTH_TOKEN}` } : {}),
});

async function getJSON(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

function dayName(d = new Date()) { return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()]; }

async function playlist() {
  const override = process.env.STREAMER_DAY;
  const day = override || dayName();
  const url = `${CONFIG.API_BASE_URL}/feed/${encodeURIComponent(CONFIG.CHANNEL)}/${encodeURIComponent(CONFIG.WEEK)}/${day}/playlist?withUrls=1`;
  console.log('[streamer] Fetching playlist for day:', day, url);
  const pl = await getJSON(url);
  if (MIN_SEC > 0 && Array.isArray(pl.items)) {
    const before = pl.items.length;
    pl.items = pl.items.filter((it) => (it.durationSec || 0) >= MIN_SEC);
    const after = pl.items.length;
    if (before !== after) console.log(`[streamer] Filtered ${before - after} items shorter than ${MIN_SEC}s`);
  }
  return pl;
}

async function now() {
  const today = new Date();
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const day = days[today.getDay()];
  const u = `${CONFIG.API_BASE_URL}/feed/${encodeURIComponent(CONFIG.CHANNEL)}/${encodeURIComponent(CONFIG.WEEK)}/${day}/now`;
  return getJSON(u);
}

async function presignedUrl(assetId) {
  const u = `${CONFIG.API_BASE_URL}/assets/${encodeURIComponent(assetId)}/url`;
  const { url } = await getJSON(u);
  return url;
}

async function getAssetInfo(assetId) {
  const u = `${CONFIG.API_BASE_URL}/assets/${encodeURIComponent(assetId)}/url`;
  const data = await getJSON(u);
  return { url: data.url, normalized: data.normalized || false };
}

function ffmpegArgs(inputUrl, offsetSec = 0, useCopyMode = false) {
  const target = (process.env.STREAMER_FORCE_RTMPS === 'true')
    ? (CONFIG.RTMP_TARGET || '').replace(/^rtmp:\/\//, 'rtmps://')
    : (CONFIG.RTMP_TARGET || '');

  // Logo overlay requires re-encoding, so disable copy mode
  const useLogoOverlay = LOGO_ENABLE && LOGO_EXISTS;
  if (useLogoOverlay && useCopyMode) {
    console.log('==> Logo overlay enabled: disabling copy mode (re-encoding required)');
    useCopyMode = false;
  }

  // Copy mode: for pre-normalized files, just stream without re-encoding
  if (useCopyMode) {
    return [
      '-loglevel', 'info',
      '-re',
      ...(offsetSec > 0 ? ['-ss', String(Math.floor(offsetSec))] : []),
      '-i', inputUrl,
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-flvflags', 'no_duration_filesize',
      '-f', 'flv',
      '-rtmp_live', 'live',
      target,
    ];
  }

  // Encode mode: for non-normalized files with audio/video fallbacks
  const [w, h] = CONFIG.RESOLUTION.split('x').map((n) => parseInt(n, 10));
  const tuneGop = (process.env.STREAMER_TUNE_GOP === 'true');

  // Build video filter chain with optional logo overlay
  let videoFilter = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;

  const args = [
    '-loglevel', 'info',
    '-re',
    ...(offsetSec > 0 ? ['-ss', String(Math.floor(offsetSec))] : []),
    '-i', inputUrl,
    // Add logo as input if enabled
    ...(useLogoOverlay ? ['-i', LOGO_PATH] : []),
  ];

  // Use filter_complex for logo overlay, otherwise simple -vf
  if (useLogoOverlay) {
    const logoInputIndex = 1;
    const audioInputIndex = 2;
    let filterComplex;

    if (LOGO_IS_VIDEO) {
      // MP4 logo: loop the video infinitely and overlay
      // Use loop filter with shortest option to loop indefinitely
      // Format: loop=loop=-1:size=32767 (max frames before loop), then setpts to sync timing
      filterComplex = `[0:v]${videoFilter}[v];[${logoInputIndex}:v]loop=loop=-1:size=32767,setpts=N/(${CONFIG.FPS}*TB),scale=${LOGO_SCALE}:-1,format=rgba,colorchannelmixer=aa=${LOGO_OPACITY}[logo];[v][logo]overlay=W-w-20:20:shortest=1[vout]`;
    } else {
      // PNG logo: static image overlay
      filterComplex = `[0:v]${videoFilter}[v];[${logoInputIndex}:v]scale=${LOGO_SCALE}:-1,format=rgba,colorchannelmixer=aa=${LOGO_OPACITY}[logo];[v][logo]overlay=W-w-20:20[vout]`;
    }

    args.push('-filter_complex', filterComplex);
    // Map only the file's own audio. FLV allows at most ONE audio stream, so the
    // previous extra silent-audio map produced two streams and ffmpeg refused to
    // start ("at most one audio stream is supported in flv").
    args.push('-map', '[vout]', '-map', '0:a?');
  } else {
    // No logo, use simple filter. Map only the file's audio (see note above).
    args.push(
      '-map', '0:v?',
      '-map', '0:a?',
      '-vf', videoFilter
    );
  }

  args.push(
    '-c:v', 'libx264',
    '-preset', CONFIG.PRESET,
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-b:v', CONFIG.VIDEO_BITRATE,
    '-maxrate', CONFIG.VIDEO_BITRATE,
    '-bufsize', '10000k',
    '-g', String(CONFIG.GOP),
    ...(tuneGop ? ['-keyint_min', String(CONFIG.GOP), '-sc_threshold', '0', '-force_key_frames', 'expr:gte(t,n_forced*1)'] : []),
    '-r', String(CONFIG.FPS),
    '-c:a', 'aac',
    '-b:a', CONFIG.AUDIO_BITRATE,
    '-ar', '48000',
    '-ac', '2',
    '-flvflags', 'no_duration_filesize',
    '-f', 'flv',
    '-rtmp_live', 'live',
    target
  );
  return args;
}

let RUNNING = false;
let CHILD = null;
let CURRENT = null; // { assetId, index, startedAt, url }
let CONTINUOUS_STATE = null; // { startedAt, sequence:[{assetId,durationSec}], slateBetweenSec }
// Bumped every time cleanupStreamer() runs. An in-flight build captures the value
// and aborts before spawning ffmpeg if it changed (i.e. a Stop/Restart wiped its
// temp files mid-build) — prevents "Impossible to open cont_0.mp4" crash loops.
let STREAM_GENERATION = 0;
let SESSION_STARTED_AT = null;
let TEMP_FILES = []; // Track temp files for cleanup
let KILL_TIMEOUT = null; // Track SIGKILL timeout
const NORMALIZE = (process.env.STREAMER_NORMALIZE === 'true');

// Logo overlay configuration
const LOGO_ENABLE = process.env.LOGO_ENABLE === 'true';
const LOGO_PATH = process.env.LOGO_PATH || '/app/assets/logo.png';
const LOGO_SCALE = parseInt(process.env.LOGO_SCALE || '200', 10);
const LOGO_OPACITY = parseFloat(process.env.LOGO_OPACITY || '0.8');
let LOGO_EXISTS = false;
let LOGO_IS_VIDEO = false;

// Cleanup function with SIGKILL fallback
async function cleanupStreamer() {
  console.log('==> Cleaning up streamer...');
  STREAM_GENERATION++; // signal any in-flight build to abort before spawning ffmpeg
  CONTINUOUS_STATE = null; // stop reporting a current clip once stopped/restarted

  // Clear any pending SIGKILL timeout
  if (KILL_TIMEOUT) {
    clearTimeout(KILL_TIMEOUT);
    KILL_TIMEOUT = null;
  }

  // Kill the child and AWAIT its actual exit (SIGINT, then SIGKILL after 5s) before
  // returning. Previously this scheduled the SIGKILL and returned immediately, so a
  // caller (e.g. /control/restart) re-armed the stream while the old ffmpeg was still
  // alive — two publishers pushing the same RTMP key → corrupt/flapping output.
  const child = CHILD;
  if (child && child.exitCode === null) {
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(killTimer); resolve(); };
      const killTimer = setTimeout(() => {
        console.warn('==> ffmpeg did not exit gracefully, sending SIGKILL');
        try { child.kill('SIGKILL'); } catch (e) { console.error('==> SIGKILL failed:', e); }
      }, 5000);
      child.once('exit', finish);
      child.once('error', finish);
      try {
        console.log('==> Sending SIGINT to ffmpeg...');
        child.kill('SIGINT');
      } catch (e) {
        console.error('==> Failed to kill child process:', e);
        finish();
      }
    });
  }

  // Clean up temp files
  if (TEMP_FILES.length > 0) {
    console.log(`==> Cleaning up ${TEMP_FILES.length} temp files...`);
    await Promise.allSettled(TEMP_FILES.map(async (f) => {
      try {
        await fs.unlink(f);
        console.log(`==> Deleted temp file: ${f}`);
      } catch (e) {
        // Ignore errors - file may already be deleted
      }
    }));
    TEMP_FILES = [];
  }
}
const DISABLE_BATCH = (process.env.STREAMER_DISABLE_BATCH === 'true');
const MAX_RETRIES = parseInt(process.env.STREAMER_MAX_RETRIES || '1', 10) || 1;
const SLATE_URL = process.env.STREAMER_SLATE_URL || '';
const SLATE_ASSET_ID = process.env.STREAMER_SLATE_ASSET_ID || '';
const SLATE_BETWEEN_SEC = parseInt(process.env.STREAMER_SLATE_BETWEEN_SEC || '0', 10) || 0;
const SLATE_IDLE_SEC = parseInt(process.env.STREAMER_SLATE_IDLE_SEC || '30', 10) || 30;
const MIN_SEC = parseInt(process.env.STREAMER_MIN_SEC || '0', 10) || 0;
const CONTINUOUS = (process.env.STREAMER_CONTINUOUS === 'true');
const CONTINUOUS_LOOPS = parseInt(process.env.STREAMER_CONTINUOUS_LOOPS || '3', 10) || 3;

// SSRF / arbitrary-input guard. Media inputs reach ffmpeg's `-i`, which honors
// file://, concat:, pipe:, http(s), etc. Only allow https media from non-internal
// hosts, or streamer-controlled local temp files. Throwing here makes the caller skip
// the item rather than letting ffmpeg read /etc/passwd or hit 169.254.169.254.
function assertSafeMediaInput(input) {
  if (typeof input !== 'string' || !input) throw new Error('empty media input');
  const scheme = (input.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/) || [])[1];
  if (scheme) {
    if (scheme.toLowerCase() !== 'https') throw new Error(`refusing media scheme: ${scheme}`);
    const host = new URL(input).hostname;
    if (
      host === 'localhost' || host === '169.254.169.254' ||
      /\.(internal|local)$/i.test(host) || host.endsWith('.railway.internal') ||
      /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
    ) throw new Error(`refusing internal media host: ${host}`);
    return;
  }
  // No scheme → must be a streamer-controlled local file.
  if (input.startsWith(os.tmpdir()) || input.startsWith('/app/')) return;
  throw new Error(`refusing local media path outside temp: ${input}`);
}

async function streamOnce(url, offsetSec, useCopyMode = false) {
  assertSafeMediaInput(url);
  // Download remote to a local temp file for stable decoding
  let localPath = url;
  let downloaded = false;
  if (/^https?:\/\//i.test(url)) {
    try {
      localPath = await downloadToTemp(url, 'single');
      downloaded = true;
    } catch (e) {
      console.error('download failed, will try streaming direct', e);
      localPath = url;
    }
  }
  // Optional normalization for first item (skip if already normalized via API)
  let normalizedPath = null;
  if (NORMALIZE && downloaded && !useCopyMode) {
    try {
      normalizedPath = await normalizeToTemp(localPath, 'single_norm');
    } catch (e) {
      console.error('normalize(first) failed, using original', e);
    }
  }

  return new Promise((resolve, reject) => {
    const inputPath = normalizedPath || localPath;
    const args = ffmpegArgs(inputPath, offsetSec, useCopyMode);
    console.log('ffmpeg', useCopyMode ? '[COPY MODE]' : '[ENCODE MODE]', args.join(' '));
    CHILD = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    CHILD.on('error', (err) => { console.error('ffmpeg spawn error', err); reject(err); });
    CHILD.stdout.on('data', (d) => process.stdout.write(d.toString()));
    CHILD.stderr.on('data', (d) => process.stderr.write(d.toString()));
    CHILD.on('exit', async (code, sig) => {
      const wasKilled = sig || code === null;
      CHILD = null;
      if (downloaded) { try { await fs.unlink(localPath); } catch {}
      }
      if (normalizedPath) { try { await fs.unlink(normalizedPath); } catch {} }
      if (wasKilled) return resolve();
      if (code === 0) resolve(); else {
        console.error('ffmpeg exited with code', code);
        reject(new Error(`ffmpeg exited ${code}`));
      }
    });
  });
}

const DOWNLOAD_TIMEOUT_MS = parseInt(process.env.STREAMER_DOWNLOAD_TIMEOUT_MS || '120000', 10);
const MAX_DOWNLOAD_BYTES = parseInt(process.env.STREAMER_MAX_DOWNLOAD_MB || '4096', 10) * 1024 * 1024;

async function downloadToTemp(url, ix, destPath) {
  assertSafeMediaInput(url);
  const tmp = destPath || path.join(os.tmpdir(), `ralphtv_${Date.now()}_${ix}.mp4`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`download failed ${res.status}`);
    const file = await fs.open(tmp, 'w');
    const writer = file.createWriteStream();
    let bytes = 0;
    await new Promise((resolve, reject) => {
      res.body.pipeTo(new WritableStream({
        write(chunk) {
          bytes += chunk.byteLength || chunk.length || 0;
          if (bytes > MAX_DOWNLOAD_BYTES) { reject(new Error('download exceeds size cap')); return; }
          writer.write(Buffer.from(chunk));
        },
        close() { writer.end(() => resolve()); },
        abort(err) { writer.destroy(err); reject(err); }
      })).catch(reject);
    });
    await file.close();
    return tmp;
  } catch (e) {
    clearTimeout(timer);
    try { await fs.unlink(tmp); } catch {} // don't leak a partial/aborted download
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function normalizeToTemp(inPath, ix) {
  const out = path.join(os.tmpdir(), `ralphtv_norm_${Date.now()}_${ix}.mp4`);
  const [w, h] = CONFIG.RESOLUTION.split('x').map((n) => parseInt(n, 10));
  const args = [
    '-loglevel', 'info',
    '-i', inPath,
    '-c:v', 'libx264', '-preset', CONFIG.PRESET, '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-b:v', CONFIG.VIDEO_BITRATE, '-maxrate', CONFIG.VIDEO_BITRATE, '-bufsize', '10000k',
    '-g', String(CONFIG.GOP), '-r', String(CONFIG.FPS),
    '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
    '-c:a', 'aac', '-b:a', CONFIG.AUDIO_BITRATE, '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', out,
  ];
  console.log('ffmpeg normalize', args.join(' '));
  await new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    p.on('error', reject);
    p.stdout.on('data', (d) => process.stdout.write(d.toString()));
    p.stderr.on('data', (d) => process.stderr.write(d.toString()));
    p.on('exit', (code) => code === 0 ? resolve() : reject(new Error('normalize exit ' + code)));
  });
  return out;
}

async function streamBatch(urls) {
  // Build concat list
  const files = [];
  const toCleanup = [];
  try {
    for (let i = 0; i < urls.length; i++) {
      const dl = await downloadToTemp(urls[i], i);
      toCleanup.push(dl);
      if (NORMALIZE) {
        const nm = await normalizeToTemp(dl, `nm_${i}`);
        files.push(nm);
        toCleanup.push(nm);
      } else {
        files.push(dl);
      }
    }
    const listPath = path.join(os.tmpdir(), `ralphtv_list_${Date.now()}.txt`);
    const listContent = files.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
    await fs.writeFile(listPath, listContent, 'utf8');
    return new Promise((resolve, reject) => {
      const [w, h] = CONFIG.RESOLUTION.split('x').map((n) => parseInt(n, 10));
      const target = (process.env.STREAMER_FORCE_RTMPS === 'true')
        ? (CONFIG.RTMP_TARGET || '').replace(/^rtmp:\/\//, 'rtmps://')
        : (CONFIG.RTMP_TARGET || '');
      const args = [
        '-loglevel', 'info',
        '-re', '-f', 'concat', '-safe', '0', '-i', listPath,
        '-c:v', 'libx264', '-preset', CONFIG.PRESET, '-profile:v', 'high',
        '-pix_fmt', 'yuv420p',
        '-b:v', CONFIG.VIDEO_BITRATE, '-maxrate', CONFIG.VIDEO_BITRATE, '-bufsize', '10000k',
        '-g', String(CONFIG.GOP), '-keyint_min', String(CONFIG.GOP), '-sc_threshold', '0', '-force_key_frames', 'expr:gte(t,n_forced*1)', '-r', String(CONFIG.FPS),
        '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
        '-c:a', 'aac', '-b:a', CONFIG.AUDIO_BITRATE, '-ar', '48000', '-ac', '2',
        '-flvflags', 'no_duration_filesize', '-f', 'flv', '-rtmp_live', 'live', target,
      ];
      console.log('ffmpeg batch', args.join(' '));
      CHILD = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      CHILD.on('error', (err) => { console.error('ffmpeg batch spawn error', err); reject(err); });
      CHILD.stdout.on('data', (d) => process.stdout.write(d.toString()));
      CHILD.stderr.on('data', (d) => process.stderr.write(d.toString()));
      CHILD.on('exit', (code, sig) => {
        CHILD = null;
        // Cleanup
        Promise.allSettled(toCleanup.map(f => fs.unlink(f))).then(() => fs.unlink(listPath).catch(() => {}));
        if (sig || code === null) return resolve();
        if (code === 0) resolve(); else {
          console.error('ffmpeg batch exited with code', code);
          reject(new Error(`ffmpeg exited ${code}`));
        }
      });
    });
  } catch (e) {
    // Cleanup on failure
    await Promise.allSettled(toCleanup.map(f => fs.unlink(f).catch(() => {})));
    throw e;
  }
}

async function streamTestSignal(seconds = 30) {
  return new Promise((resolve, reject) => {
    const [w, h] = CONFIG.RESOLUTION.split('x').map((n) => parseInt(n, 10));
    const target = (process.env.STREAMER_FORCE_RTMPS === 'true')
      ? (CONFIG.RTMP_TARGET || '').replace(/^rtmp:\/\//, 'rtmps://')
      : (CONFIG.RTMP_TARGET || '');
    const args = [
      '-loglevel', 'info',
      '-re', '-f', 'lavfi', '-i', `testsrc=size=${w}x${h}:rate=${CONFIG.FPS}`,
      '-f', 'lavfi', '-i', `sine=frequency=1000:sample_rate=48000`,
      '-t', String(Math.max(5, seconds)),
      '-c:v', 'libx264', '-preset', CONFIG.PRESET, '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-b:v', CONFIG.VIDEO_BITRATE, '-maxrate', CONFIG.VIDEO_BITRATE, '-bufsize', '10000k',
      '-g', String(CONFIG.GOP), '-keyint_min', String(CONFIG.GOP), '-sc_threshold', '0', '-force_key_frames', 'expr:gte(t,n_forced*2)', '-r', String(CONFIG.FPS),
      '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
      '-c:a', 'aac', '-b:a', CONFIG.AUDIO_BITRATE, '-ar', '48000', '-ac', '2',
      '-flvflags', 'no_duration_filesize', '-f', 'flv', '-rtmp_live', 'live', target,
    ];
    console.log('ffmpeg test-signal', args.join(' '));
    CHILD = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    CHILD.on('error', (err) => { console.error('ffmpeg test-signal spawn error', err); reject(err); });
    CHILD.stdout.on('data', (d) => process.stdout.write(d.toString()));
    CHILD.stderr.on('data', (d) => process.stderr.write(d.toString()));
    CHILD.on('exit', (code, sig) => {
      CHILD = null;
      if (sig || code === null) return resolve();
      if (code === 0) resolve(); else {
        console.error('ffmpeg test-signal exited with code', code);
        reject(new Error(`ffmpeg exited ${code}`));
      }
    });
  });
}

let SLATE_LOCAL = null;
async function ensureSlateLocal() {
  if (!SLATE_URL) return null;
  if (SLATE_LOCAL) return SLATE_LOCAL;
  try {
    const dl = await downloadToTemp(SLATE_URL, 'slate');
    if (NORMALIZE) {
      const nm = await normalizeToTemp(dl, 'slate_norm');
      SLATE_LOCAL = nm;
    } else {
      SLATE_LOCAL = dl;
    }
    return SLATE_LOCAL;
  } catch (e) {
    console.error('Failed to prepare slate', e);
    return null;
  }
}

async function streamSlate(seconds) {
  const local = await ensureSlateLocal();
  if (!local) {
    await streamTestSignal(seconds);
    return;
  }
  const [w, h] = CONFIG.RESOLUTION.split('x').map((n) => parseInt(n, 10));
  const target = (process.env.STREAMER_FORCE_RTMPS === 'true')
    ? (CONFIG.RTMP_TARGET || '').replace(/^rtmp:\/\//, 'rtmps://')
    : (CONFIG.RTMP_TARGET || '');
  const args = [
    '-loglevel', 'info', '-stream_loop', '-1', '-re', '-i', local,
    '-t', String(Math.max(1, seconds)),
    '-c:v', 'libx264', '-preset', CONFIG.PRESET, '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-b:v', CONFIG.VIDEO_BITRATE, '-maxrate', CONFIG.VIDEO_BITRATE, '-bufsize', '10000k',
    '-g', String(CONFIG.GOP), ...(process.env.STREAMER_TUNE_GOP === 'true' ? ['-keyint_min', String(CONFIG.GOP), '-sc_threshold', '0', '-force_key_frames', 'expr:gte(t,n_forced*2)'] : []), '-r', String(CONFIG.FPS),
    '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
    '-c:a', 'aac', '-b:a', CONFIG.AUDIO_BITRATE, '-ar', '48000', '-ac', '2',
    '-flvflags', 'no_duration_filesize', '-f', 'flv', '-rtmp_live', 'live', target,
  ];
  console.log('ffmpeg slate', args.join(' '));
  await new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    p.on('error', reject);
    p.stdout.on('data', (d) => process.stdout.write(d.toString()));
    p.stderr.on('data', (d) => process.stderr.write(d.toString()));
    p.on('exit', (code) => code === 0 ? resolve() : reject(new Error('slate exit ' + code)));
  });
}

function buildConcatLines(finalPaths, loopCount, slate) {
  const lines = [];
  for (let loop = 0; loop < loopCount; loop++) {
    for (const p of finalPaths) {
      lines.push(`file '${p.replace(/'/g, "'\\''")}'`);
      if (SLATE_BETWEEN_SEC > 0 && slate) lines.push(`file '${slate.replace(/'/g, "'\\''")}'`);
    }
    if (slate && SLATE_IDLE_SEC > 0) lines.push(`file '${slate.replace(/'/g, "'\\''")}'`);
  }
  return lines.join('\n');
}

async function buildContinuousList(items) {
  const toCleanup = [];
  const sessionId = String(Date.now());

  // 1) Resolve every URL + normalized flag first (fast — no downloads yet), and pick a
  //    DETERMINISTIC temp path per clip so we can write the concat list before the
  //    downloads finish.
  const specs = [];
  let allNormalized = true;
  for (let i = 0; i < items.length; i++) {
    let u, isNorm = false;
    if (items[i].url) {
      u = items[i].url;
      isNorm = items[i].normalized === true;
    } else {
      const info = await getAssetInfo(items[i].assetId);
      u = info.url;
      isNorm = info.normalized === true;
    }
    if (!isNorm) allNormalized = false;
    specs.push({
      i, url: u, isNorm,
      path: path.join(os.tmpdir(), `ralphtv_cont_${sessionId}_${i}.mp4`),
      assetId: items[i].assetId,
      durationSec: items[i].durationSec || 0,
    });
  }

  const slate = await ensureSlateLocal();
  const listPath = path.join(os.tmpdir(), `ralphtv_cont_${sessionId}.txt`);
  const loopCount = allNormalized ? 1000 : Math.max(1, CONTINUOUS_LOOPS);
  const sequence = specs.map(s => ({ assetId: s.assetId, durationSec: s.durationSec }));

  // Download (+optional normalize) one clip to its deterministic path.
  const prepareClip = async (spec) => {
    const dl = await downloadToTemp(spec.url, `cont_${spec.i}`, spec.path);
    toCleanup.push(dl); TEMP_FILES.push(dl);
    let nm = dl;
    if (NORMALIZE && !spec.isNorm) {
      nm = await normalizeToTemp(dl, `cont_norm_${sessionId}_${spec.i}`);
      toCleanup.push(nm); TEMP_FILES.push(nm);
    }
    spec.finalPath = nm;
  };

  if (allNormalized) {
    // FAST PATH (copy mode): final paths are the deterministic download paths — no
    // normalization — so we can write the list now, download only the FIRST clip, and
    // let the rest stream in behind live playback (each clip plays for minutes; a
    // download takes seconds, so ffmpeg never catches up to an un-downloaded file).
    specs.forEach(s => { s.finalPath = s.path; });
    await fs.writeFile(listPath, buildConcatLines(specs.map(s => s.finalPath), loopCount, slate), 'utf8');
    await prepareClip(specs[0]);
    const backgroundDownload = async () => {
      for (let i = 1; i < specs.length; i++) {
        if (!RUNNING) return;
        try { await prepareClip(specs[i]); }
        catch (e) { console.error(`==> background download failed for ${specs[i].assetId}:`, e?.message || e); }
      }
      console.log(`==> Background download complete: ${specs.length} clips on disk`);
    };
    console.log(`==> Continuous list built — streaming now while ${specs.length - 1} clips download: ${specs.length} items, ${loopCount} loops`);
    return { listPath, toCleanup, allNormalized, sequence, backgroundDownload };
  }

  // SLOW PATH (needs local normalization): must produce every normalized file before
  // building the list, so download+normalize all up front (rare; NORMALIZE opt-in).
  for (const spec of specs) { if (!RUNNING) break; await prepareClip(spec); }
  await fs.writeFile(listPath, buildConcatLines(specs.map(s => s.finalPath), loopCount, slate), 'utf8');
  console.log(`==> Continuous list built: ${specs.length} items, ${loopCount} loops, allNormalized=${allNormalized}`);
  return { listPath, toCleanup, allNormalized, sequence, backgroundDownload: null };
}

// In continuous mode ffmpeg plays one big concat, so there's no per-item callback.
// Derive the currently-playing clip from elapsed wall-clock time (the stream is `-re`,
// i.e. real-time) against the ordered clip durations. Returns a CURRENT-shaped object.
function computeContinuousCurrent(state) {
  const seq = state?.sequence || [];
  const slate = state?.slateBetweenSec || 0;
  const loopDur = seq.reduce((a, s) => a + (s.durationSec || 0) + slate, 0);
  if (loopDur <= 0) return null;
  let pos = ((Date.now() - state.startedAt) / 1000) % loopDur;
  for (let i = 0; i < seq.length; i++) {
    const clipDur = seq[i].durationSec || 0;
    if (pos < clipDur) {
      return { assetId: seq[i].assetId, index: i, day: state.day, startedAt: Date.now() - Math.floor(pos * 1000), offsetSec: Math.floor(pos) };
    }
    pos -= clipDur;
    if (pos < slate) {
      return { assetId: seq[i].assetId, index: i, day: state.day, startedAt: Date.now() - Math.floor(clipDur * 1000), offsetSec: Math.floor(clipDur) };
    }
    pos -= slate;
  }
  return null;
}

async function streamContinuous(items) {
  const target = (process.env.STREAMER_FORCE_RTMPS === 'true')
    ? (CONFIG.RTMP_TARGET || '').replace(/^rtmp:\/\//, 'rtmps://')
    : (CONFIG.RTMP_TARGET || '');
  const gen = STREAM_GENERATION; // capture before the (slow) download/build below
  const { listPath, toCleanup, allNormalized, sequence, backgroundDownload } = await buildContinuousList(items);

  // The build takes several seconds to download all clips. If a control action
  // (Stop/Restart/test-signal) fired during that window, its cleanupStreamer() wiped
  // these temp files — bail cleanly instead of launching ffmpeg against deleted inputs
  // (which failed with "Impossible to open …cont_0.mp4"). The loop rebuilds next cycle.
  if (!RUNNING) {
    for (const f of toCleanup) { try { await fs.unlink(f); } catch {} }
    return;
  }
  try {
    await fs.access(listPath);
  } catch {
    throw new Error('continuous list was cleaned up before ffmpeg could start');
  }

  // Force encode mode if STREAMER_FORCE_ENCODE is set (useful for mixed audio/no-audio playlists)
  const forceEncode = (process.env.STREAMER_FORCE_ENCODE === 'true');

  // Logo overlay requires re-encoding, so force encode mode
  const useLogoOverlay = LOGO_ENABLE && LOGO_EXISTS;
  const needsEncode = forceEncode || useLogoOverlay;

  // ABR (opt-in): publish TWO renditions so hls.js adapts to the viewer's bandwidth.
  // The source 720p is stream-COPIED (no extra encode cost); only the small rendition
  // is encoded. The relay's hls_variant stitches them into one master at stream.m3u8.
  const abr = (process.env.STREAMER_ABR === 'true');
  let args;
  if (allNormalized && !needsEncode && abr) {
    const MID_H = parseInt(process.env.ABR_MID_HEIGHT || '480', 10);
    const MID_VB = process.env.ABR_MID_VBITRATE || '1200k';
    const MID_AB = process.env.ABR_MID_ABITRATE || '128k';
    const LOW_H = parseInt(process.env.ABR_LOW_HEIGHT || '360', 10);
    const LOW_VB = process.env.ABR_LOW_VBITRATE || '700k';
    const LOW_AB = process.env.ABR_LOW_ABITRATE || '96k';
    // One downscaled + encoded rendition. Keyframes forced every 1s so its segments
    // line up with the copied high variant for clean adaptive switching.
    const encVariant = (h, vb, ab, suffix) => [
      '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', `scale=-2:${h}`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
      '-b:v', vb, '-maxrate', vb, '-bufsize', `${(parseInt(vb, 10) || 700) * 2}k`,
      '-g', String(CONFIG.FPS), '-keyint_min', String(CONFIG.FPS), '-sc_threshold', '0',
      '-force_key_frames', 'expr:gte(t,n_forced*1)',
      '-r', String(CONFIG.FPS),
      '-c:a', 'aac', '-b:a', ab, '-ar', '48000', '-ac', '2',
      '-flvflags', 'no_duration_filesize', '-f', 'flv', '-rtmp_live', 'live', `${target}_${suffix}`,
    ];
    console.log(`==> Using COPY MODE + ABR (720p copy + ${MID_H}p@${MID_VB} + ${LOW_H}p@${LOW_VB})`);
    args = [
      '-loglevel', 'info',
      '-re', '-f', 'concat', '-safe', '0', '-i', listPath,
      // Variant "high": source, stream-copied (no re-encode).
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'copy', '-c:a', 'copy',
      '-flvflags', 'no_duration_filesize', '-f', 'flv', '-rtmp_live', 'live', `${target}_high`,
      // Variants "mid" (480p) and "low" (360p), both encoded.
      ...encVariant(MID_H, MID_VB, MID_AB, 'mid'),
      ...encVariant(LOW_H, LOW_VB, LOW_AB, 'low'),
    ];
  } else if (allNormalized && !needsEncode) {
    // COPY MODE: All assets pre-normalized, just stream without re-encoding
    console.log('==> Using COPY MODE (all assets pre-normalized)');
    args = [
      '-loglevel', 'info',
      '-re', '-f', 'concat', '-safe', '0', '-i', listPath,
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-flvflags', 'no_duration_filesize', '-f', 'flv', '-rtmp_live', 'live', target,
    ];
  } else {
    // ENCODE MODE: Some assets not normalized, or forced encode for audio safety
    let reason = forceEncode ? 'forced via STREAMER_FORCE_ENCODE' : 'some assets not pre-normalized';
    if (useLogoOverlay) reason = 'logo overlay enabled';
    console.log(`==> Using ENCODE MODE (${reason}) - will add silent audio if needed`);
    const [w, h] = CONFIG.RESOLUTION.split('x').map((n) => parseInt(n, 10));

    // Build filter_complex with optional logo overlay
    const videoFilter = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
    let filterComplex = '[0:a?][1:a]amerge=inputs=2,pan=stereo|c0<c0+c2|c1<c1+c3[aout]';
    let videoMap = '0:v';

    // Add silent audio source, use aselect to pick real audio if exists, otherwise silent
    args = [
      '-loglevel', 'info',
      '-re', '-f', 'concat', '-safe', '0', '-i', listPath,
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    ];

    // Add logo input and update filter if logo overlay enabled
    if (useLogoOverlay) {
      args.push('-i', LOGO_PATH);
      const logoInputIndex = 2;
      let logoFilter;

      if (LOGO_IS_VIDEO) {
        // MP4 logo: loop infinitely and overlay
        logoFilter = `[0:v]${videoFilter}[v];[${logoInputIndex}:v]loop=loop=-1:size=32767,setpts=N/(${CONFIG.FPS}*TB),scale=${LOGO_SCALE}:-1,format=rgba,colorchannelmixer=aa=${LOGO_OPACITY}[logo];[v][logo]overlay=W-w-20:20:shortest=1[vout]`;
      } else {
        // PNG logo: static image overlay
        logoFilter = `[0:v]${videoFilter}[v];[${logoInputIndex}:v]scale=${LOGO_SCALE}:-1,format=rgba,colorchannelmixer=aa=${LOGO_OPACITY}[logo];[v][logo]overlay=W-w-20:20[vout]`;
      }

      // Combine video and audio filters
      filterComplex = `${logoFilter};[0:a?][1:a]amerge=inputs=2,pan=stereo|c0<c0+c2|c1<c1+c3[aout]`;
      videoMap = '[vout]';

      args.push(
        '-filter_complex', filterComplex,
        '-map', videoMap,
        '-map', '[aout]',
      );
    } else {
      // No logo, use simple video filter and audio filter_complex
      args.push(
        '-vf', videoFilter,
        '-filter_complex', filterComplex,
        '-map', '0:v',
        '-map', '[aout]',
      );
    }

    args.push(
      '-c:v', 'libx264', '-preset', CONFIG.PRESET, '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-b:v', CONFIG.VIDEO_BITRATE, '-maxrate', CONFIG.VIDEO_BITRATE, '-bufsize', '10000k',
      '-g', String(CONFIG.GOP),
      '-keyint_min', String(CONFIG.GOP),
      '-sc_threshold', '0',
      '-force_key_frames', 'expr:gte(t,n_forced*1)',
      '-r', String(CONFIG.FPS),
      '-c:a', 'aac', '-b:a', CONFIG.AUDIO_BITRATE, '-ar', '48000', '-ac', '2',
      // Removed -shortest to prevent premature stream termination in continuous mode
      '-flvflags', 'no_duration_filesize', '-f', 'flv', '-rtmp_live', 'live', target,
    );
  }
  // If a Stop/Restart/SIGTERM fired while we were downloading (it bumps
  // STREAM_GENERATION and wipes TEMP_FILES), the list now points at deleted files.
  // Abort before spawning so we don't crash-loop; the caller falls back cleanly.
  if (gen !== STREAM_GENERATION || !RUNNING) {
    await Promise.allSettled(toCleanup.map(f => fs.unlink(f).catch(() => {})));
    await fs.unlink(listPath).catch(() => {});
    throw new Error('continuous build aborted (stream restarted during setup)');
  }
  // Kick off the remaining downloads behind live playback (fire-and-forget; it stops
  // itself if RUNNING flips false). ffmpeg reads at -re (1x) so it can't outrun this.
  if (backgroundDownload) backgroundDownload();
  console.log('ffmpeg continuous', args.join(' '));
  // Record the play sequence + start time + which day it is so /status can report the
  // real current clip AND the exact schedule day (an asset can appear on several days).
  CONTINUOUS_STATE = { startedAt: Date.now(), sequence, slateBetweenSec: SLATE_BETWEEN_SEC, day: (process.env.STREAMER_DAY || dayName()) };
  await new Promise((resolve, reject) => {
    CHILD = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    CHILD.on('error', (err) => { CONTINUOUS_STATE = null; console.error('ffmpeg continuous spawn error', err); reject(err); });
    CHILD.stdout.on('data', (d) => process.stdout.write(d.toString()));
    CHILD.stderr.on('data', (d) => process.stderr.write(d.toString()));
    CHILD.on('exit', (code) => {
      CHILD = null;
      CONTINUOUS_STATE = null;
      Promise.allSettled(toCleanup.map(f => fs.unlink(f))).then(() => fs.unlink(listPath).catch(() => {}));
      if (code === 0) resolve(); else {
        console.error('ffmpeg continuous exited with code', code);
        reject(new Error('continuous exit ' + code));
      }
    });
  });
}

async function main() {
  if (!CONFIG.API_BASE_URL || !CONFIG.RTMP_TARGET) {
    console.error('Missing API_BASE_URL or RTMP_TARGET');
    process.exit(1);
  }

  // Check if logo file exists
  if (LOGO_ENABLE) {
    try {
      await fs.access(LOGO_PATH);
      LOGO_EXISTS = true;

      // Detect if logo is video (MP4) or image (PNG)
      const ext = LOGO_PATH.toLowerCase();
      LOGO_IS_VIDEO = ext.endsWith('.mp4') || ext.endsWith('.mov');

      const logoType = LOGO_IS_VIDEO ? 'animated (looping)' : 'static';
      console.log(`==> Logo overlay enabled: ${LOGO_PATH} (${logoType}, scale=${LOGO_SCALE}px, opacity=${LOGO_OPACITY})`);
    } catch {
      console.warn(`==> Logo overlay enabled but file not found: ${LOGO_PATH}`);
      console.warn('==> Streaming will continue without logo overlay');
    }
  } else {
    console.log('==> Logo overlay disabled (set LOGO_ENABLE=true to enable)');
  }

  // Tiny HTTP server for Railway web mode
  const port = process.env.PORT || 3001;
  const server = http.createServer(async (req, res) => {
    // Basic CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Control-Token');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // Opt-in auth for the state-changing /control/* endpoints. When
    // STREAMER_CONTROL_TOKEN is set, every control call must present it as a Bearer
    // token (or X-Control-Token header). When it is unset, enforcement is disabled
    // so existing deploys keep working until the secret is configured.
    // NOTE: the admin UI calls these endpoints directly from the browser, so this
    // token ends up in client JS — it stops opportunistic scanners, not a determined
    // attacker. Proper fix (tracked as follow-up): proxy control through the backend,
    // which already authenticates the admin and holds the streamer's service token.
    if (req.url && req.url.startsWith('/control/')) {
      const required = process.env.STREAMER_CONTROL_TOKEN || '';
      if (required) {
        const header = req.headers['authorization'] || '';
        const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
        const provided = bearer || req.headers['x-control-token'] || '';
        if (String(provided) !== String(required)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
      }
    }

    if (req.url && (req.url === '/' || req.url.startsWith('/healthz'))) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    if (req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const sessionTimeSec = RUNNING && SESSION_STARTED_AT ? Math.floor((Date.now() - SESSION_STARTED_AT) / 1000) : 0;
      // In continuous mode, derive the real current clip from elapsed time; otherwise
      // use the per-item CURRENT set by the single/sequential paths.
      let current = CURRENT;
      if (RUNNING && CONTINUOUS_STATE) {
        const computed = computeContinuousCurrent(CONTINUOUS_STATE);
        if (computed) current = computed;
      }
      res.end(JSON.stringify({ running: RUNNING, current, sessionStartedAt: SESSION_STARTED_AT, sessionTimeSec }));
      return;
    }
    if (req.url === '/debug/playlist') {
      try {
        const pl = await playlist();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(pl));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e?.message || e) }));
      }
      return;
    }
    if (req.url === '/debug/config') {
      const cfg = {
        channel: CONFIG.CHANNEL,
        week: CONFIG.WEEK,
        rtmpTarget: (CONFIG.RTMP_TARGET || '').slice(0, 16) + '…',
        streamerDay: process.env.STREAMER_DAY || null,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cfg));
      return;
    }
    if (req.url === '/debug/ffmpeg') {
      try {
        await new Promise((resolve, reject) => {
          const c = spawn('ffmpeg', ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] });
          let out = '';
          c.stdout.on('data', (d) => out += d.toString());
          c.stderr.on('data', (d) => out += d.toString());
          c.on('error', reject);
          c.on('exit', (code) => code === 0 ? resolve(out) : reject(new Error('ffmpeg exit ' + code)) );
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ present: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ present: false, error: String(e?.message || e) }));
      }
      return;
    }
    if (req.url === '/control/start' && req.method === 'POST') {
      RUNNING = true;
      if (!SESSION_STARTED_AT) SESSION_STARTED_AT = Date.now();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === '/control/stop' && req.method === 'POST') {
      RUNNING = false;
      await cleanupStreamer();
      SESSION_STARTED_AT = null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === '/control/restart' && req.method === 'POST') {
      RUNNING = false;
      await cleanupStreamer();
      setTimeout(() => { RUNNING = true; SESSION_STARTED_AT = Date.now(); }, 800);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url && req.url.startsWith('/control/test-signal') && req.method === 'POST') {
      // Optional seconds param via query
      const q = new URL(req.url, 'http://localhost');
      const sec = parseInt(q.searchParams.get('seconds') || '30', 10) || 30;
      await cleanupStreamer();
      RUNNING = false;
      // Fire-and-forget the test signal so the HTTP call completes successfully
      (async () => {
        try { await streamTestSignal(sec); } catch (e) { console.error('test-signal failed', e); }
      })();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, seconds: sec }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  server.listen(port, () => console.log(`Streamer health on :${port}`));

  // Loop forever
  // At start of each cycle, compute pointer and decide list
  let errCount = 0;
  for (;;) {
    try {
      if (!RUNNING) { await sleep(1000); continue; }
      const pl = await playlist();
      const ptr = await now();
      const items = pl.items || [];
      if (!items.length) { 
        console.log('No playlist items. Slate for idle...');
        try { await streamSlate(SLATE_IDLE_SEC); } catch (e) { console.error('idle slate failed', e); await sleep(5000); }
        continue; 
      }

      // Continuous mode: single ffmpeg process for the entire set
      if (CONTINUOUS) {
        try {
          await streamContinuous(items);
        } catch (e) {
          console.error('continuous mode error', e);
          // Fallback: sequential normalized per item with slate between.
          // Always re-fetch a FRESH presigned URL (the playlist's item.url expires
          // after ~10 min, so reusing it here 403s). Prefer copy mode for normalized
          // assets so we avoid the re-encode path entirely.
          for (let i = 0; i < items.length; i++) {
            if (!RUNNING) break;
            let u, isNorm = false;
            try {
              const info = await getAssetInfo(items[i].assetId);
              u = info.url;
              isNorm = info.normalized;
            } catch (e) {
              console.error('fallback getAssetInfo failed', items[i].assetId, e?.message || e);
              continue;
            }
            try { await streamOnce(u, 0, isNorm); } catch (err) { console.error('sequential fallback item failed', err); }
            if (SLATE_BETWEEN_SEC > 0) { try { await streamSlate(SLATE_BETWEEN_SEC); } catch {} }
          }
        }
        continue;
      }
      let idx = Math.max(0, Math.min(items.length - 1, ptr.index || 0));
      let offset = Math.max(0, ptr.offsetSec || 0);

      const mode = (pl.playbackMode || 'loop');
      console.log('Mode', mode, 'Start at', idx, 'offset', offset);

      // play from pointer to end; use single for first if offset>0, then batch
      if (idx < items.length) {
        const first = items[idx];
        let firstUrl, isNormalized = false;
        if (first.url) {
          firstUrl = first.url;
        } else {
          const info = await getAssetInfo(first.assetId);
          firstUrl = info.url;
          isNormalized = info.normalized;
        }
        CURRENT = { assetId: first.assetId, index: idx, startedAt: Date.now(), url: firstUrl };
        // Retry logic for first item
        let attempts = 0;
        while (attempts <= MAX_RETRIES) {
          try { await streamOnce(firstUrl, offset, isNormalized); break; }
          catch (e) { attempts++; console.error(`first item failed (attempt ${attempts})`, e); if (attempts > MAX_RETRIES) throw e; }
        }
        if (SLATE_BETWEEN_SEC > 0 && (DISABLE_BATCH || idx + 1 >= items.length)) {
          try { await streamSlate(SLATE_BETWEEN_SEC); } catch (e) { console.error('between slate failed', e); }
        }
      }
      if (idx + 1 < items.length && RUNNING) {
        const urls = [];
        for (let i = idx + 1; i < items.length; i++) {
          const it = items[i];
          urls.push(it.url || (await presignedUrl(it.assetId)));
        }
        CURRENT = null; // batch doesn't track per-item
        if (urls.length && !DISABLE_BATCH) {
          try {
            await streamBatch(urls);
          } catch (e) {
            console.error('batch failed; falling back to sequential items', e);
            // Fallback: sequential
            for (let j = 0; j < urls.length; j++) {
              if (!RUNNING) break;
              const u = urls[j];
              let attempts = 0;
              while (attempts <= MAX_RETRIES) {
                try { await streamOnce(u, 0); break; }
                catch (err) { attempts++; console.error(`item ${idx+1+j} failed (attempt ${attempts})`, err); if (attempts > MAX_RETRIES) break; }
              }
              if (SLATE_BETWEEN_SEC > 0) { try { await streamSlate(SLATE_BETWEEN_SEC); } catch (e) {} }
            }
          }
        } else if (urls.length && DISABLE_BATCH) {
          // Always sequential if batch disabled
          for (let j = 0; j < urls.length; j++) {
            if (!RUNNING) break;
            let attempts = 0;
            while (attempts <= MAX_RETRIES) {
              try { await streamOnce(urls[j], 0); break; }
              catch (err) { attempts++; console.error(`item ${idx+1+j} failed (attempt ${attempts})`, err); if (attempts > MAX_RETRIES) break; }
            }
            if (SLATE_BETWEEN_SEC > 0) { try { await streamSlate(SLATE_BETWEEN_SEC); } catch (e) {} }
          }
        }
      }

      if (mode === 'playthru') {
        console.log('Play-through ended. Sleeping...');
        CURRENT = null;
        try { await streamSlate(SLATE_IDLE_SEC); } catch (e) { console.error('end slate failed', e); await sleep(5000); }
        continue;
      }

      // loop: continue from start (batch)
      if (RUNNING && idx > 0) {
        const urls = [];
        for (let i = 0; i < idx; i++) {
          const it = items[i];
          urls.push(it.url || (await presignedUrl(it.assetId)));
        }
        CURRENT = null;
        if (urls.length && !DISABLE_BATCH) {
          try {
            await streamBatch(urls);
          } catch (e) {
            console.error('batch(loop) failed; falling back to sequential', e);
            for (let j = 0; j < urls.length; j++) {
              if (!RUNNING) break;
              let attempts = 0;
              while (attempts <= MAX_RETRIES) {
                try { await streamOnce(urls[j], 0); break; }
                catch (err) { attempts++; console.error(`loop item ${j} failed (attempt ${attempts})`, err); if (attempts > MAX_RETRIES) break; }
              }
            }
          }
        } else if (urls.length && DISABLE_BATCH) {
          for (let j = 0; j < urls.length; j++) {
            if (!RUNNING) break;
            let attempts = 0;
            while (attempts <= MAX_RETRIES) {
              try { await streamOnce(urls[j], 0); break; }
              catch (err) { attempts++; console.error(`loop item ${j} failed (attempt ${attempts})`, err); if (attempts > MAX_RETRIES) break; }
            }
            if (SLATE_BETWEEN_SEC > 0) { try { await streamSlate(SLATE_BETWEEN_SEC); } catch (e) {} }
          }
        }
      }
      CURRENT = null;
      errCount = 0; // clean cycle — reset backoff
    } catch (e) {
      // Exponential backoff (5s→60s) so an unreachable backend/relay isn't hammered
      // every 5s indefinitely.
      errCount++;
      const backoff = Math.min(5000 * Math.pow(2, errCount - 1), 60000);
      console.error(`Streamer error (retry in ${Math.round(backoff / 1000)}s)`, e);
      await sleep(backoff);
    }
  }
}

// Process signal handlers for graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n==> Received SIGINT, cleaning up...');
  RUNNING = false;
  await cleanupStreamer();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n==> Received SIGTERM, cleaning up...');
  RUNNING = false;
  await cleanupStreamer();
  process.exit(0);
});

process.on('uncaughtException', async (err) => {
  console.error('==> Uncaught exception:', err);
  RUNNING = false;
  // Synchronous best-effort kill first — after an uncaught error the event loop may be
  // unreliable, so don't depend solely on the async cleanup to reap ffmpeg before exit
  // (an orphaned ffmpeg keeps pushing RTMP after the container restarts).
  if (CHILD) { try { CHILD.kill('SIGKILL'); } catch {} }
  await cleanupStreamer();
  process.exit(1);
});

main();
