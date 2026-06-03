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
    // Add silent audio source as fallback
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
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
    args.push('-map', '[vout]', '-map', '0:a?', '-map', `${audioInputIndex}:a`);
  } else {
    // No logo, use simple filter
    args.push(
      '-map', '0:v?',
      '-map', '0:a?',
      '-map', '1:a',
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

  // Clear any pending SIGKILL timeout
  if (KILL_TIMEOUT) {
    clearTimeout(KILL_TIMEOUT);
    KILL_TIMEOUT = null;
  }

  // Kill child process with fallback to SIGKILL
  if (CHILD) {
    try {
      console.log('==> Sending SIGINT to ffmpeg...');
      CHILD.kill('SIGINT');

      // Set up SIGKILL fallback after 5 seconds
      KILL_TIMEOUT = setTimeout(() => {
        if (CHILD) {
          console.warn('==> ffmpeg did not exit gracefully, sending SIGKILL');
          try { CHILD.kill('SIGKILL'); } catch (e) {
            console.error('==> SIGKILL failed:', e);
          }
        }
      }, 5000);
    } catch (e) {
      console.error('==> Failed to kill child process:', e);
    }
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

async function streamOnce(url, offsetSec, useCopyMode = false) {
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

async function downloadToTemp(url, ix) {
  const tmp = path.join(os.tmpdir(), `ralphtv_${Date.now()}_${ix}.mp4`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed ${res.status}`);
  const file = await fs.open(tmp, 'w');
  const writer = file.createWriteStream();
  await new Promise((resolve, reject) => {
    res.body.pipeTo(new WritableStream({
      write(chunk) { writer.write(Buffer.from(chunk)); },
      close() { writer.end(() => resolve()); },
      abort(err) { writer.destroy(err); reject(err); }
    })).catch(reject);
  });
  await file.close();
  return tmp;
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

async function buildContinuousList(items) {
  // Check if items are pre-normalized via API; use normalized URLs if available
  const toCleanup = [];
  const normItems = [];
  let allNormalized = true;

  for (let i = 0; i < items.length; i++) {
    let u, isNorm = false;
    if (items[i].url) {
      u = items[i].url;
      // Strict check: only trust explicit normalized=true from backend
      isNorm = items[i].normalized === true;
      console.log(`==> Asset ${items[i].assetId}: normalized=${isNorm} (from playlist)`);
    } else {
      const info = await getAssetInfo(items[i].assetId);
      console.log(`==> Asset ${items[i].assetId}: normalized=${info.normalized} (from API)`);
      u = info.url;
      // Strict check: only trust explicit normalized=true from backend
      isNorm = info.normalized === true;
    }

    if (!isNorm) allNormalized = false;

    const dl = await downloadToTemp(u, `cont_${i}`);
    toCleanup.push(dl);
    TEMP_FILES.push(dl); // Track for global cleanup

    // Only do local normalization if not pre-normalized and NORMALIZE flag is set
    let nm = dl;
    if (NORMALIZE && !isNorm) {
      nm = await normalizeToTemp(dl, `cont_norm_${i}`);
      toCleanup.push(nm);
      TEMP_FILES.push(nm); // Track for global cleanup
    }
    normItems.push({ path: nm });
  }

  const slate = await ensureSlateLocal();
  const listPath = path.join(os.tmpdir(), `ralphtv_cont_${Date.now()}.txt`);
  let lines = [];

  // For copy mode, use many loops to maintain continuous stream for hours
  // For encode mode, use configured loops to avoid excessive processing
  const loopCount = allNormalized ? 1000 : Math.max(1, CONTINUOUS_LOOPS);

  for (let loop = 0; loop < loopCount; loop++) {
    for (let i = 0; i < normItems.length; i++) {
      const it = normItems[i];
      lines.push(`file '${it.path.replace(/'/g, "'\\''")}'`);
      if (SLATE_BETWEEN_SEC > 0 && slate) {
        lines.push(`file '${slate.replace(/'/g, "'\\''")}'`);
      }
    }
    if (slate && SLATE_IDLE_SEC > 0) {
      lines.push(`file '${slate.replace(/'/g, "'\\''")}'`);
    }
  }
  await fs.writeFile(listPath, lines.join('\n'), 'utf8');
  console.log(`==> Continuous list built: ${normItems.length} items, ${loopCount} loops, allNormalized=${allNormalized}`);
  return { listPath, toCleanup, allNormalized };
}

async function streamContinuous(items) {
  const target = (process.env.STREAMER_FORCE_RTMPS === 'true')
    ? (CONFIG.RTMP_TARGET || '').replace(/^rtmp:\/\//, 'rtmps://')
    : (CONFIG.RTMP_TARGET || '');
  const { listPath, toCleanup, allNormalized } = await buildContinuousList(items);

  // Force encode mode if STREAMER_FORCE_ENCODE is set (useful for mixed audio/no-audio playlists)
  const forceEncode = (process.env.STREAMER_FORCE_ENCODE === 'true');

  // Logo overlay requires re-encoding, so force encode mode
  const useLogoOverlay = LOGO_ENABLE && LOGO_EXISTS;
  const needsEncode = forceEncode || useLogoOverlay;

  let args;
  if (allNormalized && !needsEncode) {
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
  console.log('ffmpeg continuous', args.join(' '));
  await new Promise((resolve, reject) => {
    CHILD = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    CHILD.on('error', (err) => { console.error('ffmpeg continuous spawn error', err); reject(err); });
    CHILD.stdout.on('data', (d) => process.stdout.write(d.toString()));
    CHILD.stderr.on('data', (d) => process.stderr.write(d.toString()));
    CHILD.on('exit', (code) => {
      CHILD = null;
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
      res.end(JSON.stringify({ running: RUNNING, current: CURRENT, sessionStartedAt: SESSION_STARTED_AT, sessionTimeSec }));
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
          // Fallback: sequential normalized per item with slate between
          for (let i = 0; i < items.length; i++) {
            if (!RUNNING) break;
            let u, isNorm = false;
            if (items[i].url) {
              u = items[i].url;
            } else {
              const info = await getAssetInfo(items[i].assetId);
              u = info.url;
              isNorm = info.normalized;
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
    } catch (e) {
      console.error('Streamer error', e);
      await sleep(5000);
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
  await cleanupStreamer();
  process.exit(1);
});

main();
