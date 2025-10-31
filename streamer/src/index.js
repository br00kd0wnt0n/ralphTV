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
  return getJSON(url);
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

function ffmpegArgs(inputUrl, offsetSec = 0) {
  const [w, h] = CONFIG.RESOLUTION.split('x').map((n) => parseInt(n, 10));
  // Use target as provided unless FORCE_RTMPS is true
  const target = (process.env.STREAMER_FORCE_RTMPS === 'true')
    ? (CONFIG.RTMP_TARGET || '').replace(/^rtmp:\/\//, 'rtmps://')
    : (CONFIG.RTMP_TARGET || '');
  const args = [
    '-loglevel', 'info',
    '-re',
    ...(offsetSec > 0 ? ['-ss', String(Math.floor(offsetSec))] : []),
    '-i', inputUrl,
    '-c:v', 'libx264',
    '-preset', CONFIG.PRESET,
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-b:v', CONFIG.VIDEO_BITRATE,
    '-maxrate', CONFIG.VIDEO_BITRATE,
    '-bufsize', '10000k',
    '-g', String(CONFIG.GOP),
    '-r', String(CONFIG.FPS),
    '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
    '-c:a', 'aac',
    '-b:a', CONFIG.AUDIO_BITRATE,
    '-ar', '48000',
    '-ac', '2',
    '-flvflags', 'no_duration_filesize',
    '-f', 'flv',
    '-rtmp_live', 'live',
    target,
  ];
  return args;
}

let RUNNING = false;
let CHILD = null;
let CURRENT = null; // { assetId, index, startedAt, url }
let SESSION_STARTED_AT = null;

async function streamOnce(url, offsetSec) {
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

  return new Promise((resolve, reject) => {
    // Use -ss before -i for fast seek when local file
    const [w, h] = CONFIG.RESOLUTION.split('x').map((n) => parseInt(n, 10));
    const target = (process.env.STREAMER_FORCE_RTMPS === 'true')
      ? (CONFIG.RTMP_TARGET || '').replace(/^rtmp:\/\//, 'rtmps://')
      : (CONFIG.RTMP_TARGET || '');
    const args = [
      '-loglevel', 'info',
      '-re',
      ...(offsetSec > 0 ? ['-ss', String(Math.floor(offsetSec))] : []),
      '-i', localPath,
      '-c:v', 'libx264', '-preset', CONFIG.PRESET, '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-b:v', CONFIG.VIDEO_BITRATE, '-maxrate', CONFIG.VIDEO_BITRATE, '-bufsize', '10000k',
      '-g', String(CONFIG.GOP), '-r', String(CONFIG.FPS),
      '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
      '-c:a', 'aac', '-b:a', CONFIG.AUDIO_BITRATE, '-ar', '48000', '-ac', '2',
      '-flvflags', 'no_duration_filesize', '-f', 'flv', '-rtmp_live', 'live', target,
    ];
    console.log('ffmpeg', args.join(' '));
    CHILD = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    CHILD.on('error', (err) => { console.error('ffmpeg spawn error', err); reject(err); });
    CHILD.stdout.on('data', (d) => process.stdout.write(d.toString()));
    CHILD.stderr.on('data', (d) => process.stderr.write(d.toString()));
    CHILD.on('exit', async (code, sig) => {
      const wasKilled = sig || code === null;
      CHILD = null;
      if (downloaded) { try { await fs.unlink(localPath); } catch {}
      }
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

async function streamBatch(urls) {
  // Build concat list
  const files = [];
  try {
    for (let i = 0; i < urls.length; i++) {
      files.push(await downloadToTemp(urls[i], i));
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
        '-g', String(CONFIG.GOP), '-r', String(CONFIG.FPS),
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
        Promise.allSettled(files.map(f => fs.unlink(f))).then(() => fs.unlink(listPath).catch(() => {}));
        if (sig || code === null) return resolve();
        if (code === 0) resolve(); else {
          console.error('ffmpeg batch exited with code', code);
          reject(new Error(`ffmpeg exited ${code}`));
        }
      });
    });
  } catch (e) {
    // Cleanup on failure
    await Promise.allSettled(files.map(f => fs.unlink(f).catch(() => {})));
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
      '-g', String(CONFIG.GOP), '-r', String(CONFIG.FPS),
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

async function main() {
  if (!CONFIG.API_BASE_URL || !CONFIG.RTMP_TARGET) {
    console.error('Missing API_BASE_URL or RTMP_TARGET');
    process.exit(1);
  }

  // Tiny HTTP server for Railway web mode
  const port = process.env.PORT || 3001;
  const server = http.createServer(async (req, res) => {
    // Basic CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

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
      if (CHILD) {
        try { CHILD.kill('SIGINT'); } catch {}
      }
      SESSION_STARTED_AT = null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === '/control/restart' && req.method === 'POST') {
      RUNNING = false;
      if (CHILD) {
        try { CHILD.kill('SIGINT'); } catch {}
      }
      setTimeout(() => { RUNNING = true; SESSION_STARTED_AT = Date.now(); }, 800);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url && req.url.startsWith('/control/test-signal') && req.method === 'POST') {
      // Optional seconds param via query
      const q = new URL(req.url, 'http://localhost');
      const sec = parseInt(q.searchParams.get('seconds') || '30', 10) || 30;
      if (CHILD) { try { CHILD.kill('SIGINT'); } catch {} }
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
      if (!items.length) { console.log('No playlist items. Sleeping...'); await sleep(15000); continue; }
      let idx = Math.max(0, Math.min(items.length - 1, ptr.index || 0));
      let offset = Math.max(0, ptr.offsetSec || 0);

      const mode = (pl.playbackMode || 'loop');
      console.log('Mode', mode, 'Start at', idx, 'offset', offset);

      // play from pointer to end; use single for first if offset>0, then batch
      if (idx < items.length) {
        const first = items[idx];
        const firstUrl = first.url || (await presignedUrl(first.assetId));
        CURRENT = { assetId: first.assetId, index: idx, startedAt: Date.now(), url: firstUrl };
        await streamOnce(firstUrl, offset);
      }
      if (idx + 1 < items.length && RUNNING) {
        const urls = [];
        for (let i = idx + 1; i < items.length; i++) {
          const it = items[i];
          urls.push(it.url || (await presignedUrl(it.assetId)));
        }
        CURRENT = null; // batch doesn't track per-item
        if (urls.length) await streamBatch(urls);
      }

      if (mode === 'playthru') {
        console.log('Play-through ended. Sleeping...');
        CURRENT = null;
        await sleep(60000);
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
        if (urls.length) await streamBatch(urls);
      }
      CURRENT = null;
    } catch (e) {
      console.error('Streamer error', e);
      await sleep(5000);
    }
  }
}

main();
