import { spawn } from 'node:child_process';
import http from 'node:http';
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

async function playlist() {
  const u = `${CONFIG.API_BASE_URL}/feed/${encodeURIComponent(CONFIG.CHANNEL)}/${encodeURIComponent(CONFIG.WEEK)}/today/playlist?withUrls=1`;
  // fall back to exact day if /today not implemented
  const today = new Date();
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const day = days[today.getDay()];
  const legacy = `${CONFIG.API_BASE_URL}/feed/${encodeURIComponent(CONFIG.CHANNEL)}/${encodeURIComponent(CONFIG.WEEK)}/${day}/playlist?withUrls=1`;
  try { return await getJSON(u); } catch { return await getJSON(legacy); }
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
  const args = [
    '-re',
    ...(offsetSec > 0 ? ['-ss', String(Math.floor(offsetSec))] : []),
    '-i', inputUrl,
    '-c:v', 'libx264',
    '-preset', CONFIG.PRESET,
    '-profile:v', 'high',
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
    '-f', 'flv',
    CONFIG.RTMP_TARGET,
  ];
  return args;
}

let RUNNING = false;
let CHILD = null;
let CURRENT = null; // { assetId, index, startedAt, url }

async function streamOnce(url, offsetSec) {
  return new Promise((resolve, reject) => {
    const args = ffmpegArgs(url, offsetSec);
    console.log('ffmpeg', args.join(' '));
    CHILD = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    CHILD.stdout.on('data', (d) => process.stdout.write(d.toString()));
    CHILD.stderr.on('data', (d) => process.stderr.write(d.toString()));
    CHILD.on('exit', (code, sig) => {
      const wasKilled = sig || code === null;
      CHILD = null;
      if (wasKilled) return resolve();
      if (code === 0) resolve(); else reject(new Error(`ffmpeg exited ${code}`));
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
      res.end(JSON.stringify({ running: RUNNING, current: CURRENT }));
      return;
    }
    if (req.url === '/control/start' && req.method === 'POST') {
      RUNNING = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === '/control/stop' && req.method === 'POST') {
      RUNNING = false;
      if (CHILD) {
        try { CHILD.kill('SIGINT'); } catch {}
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
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

      // play from pointer to end
      for (let i = idx; i < items.length; i++) {
        if (!RUNNING) break;
        const it = items[i];
        const url = it.url || (await presignedUrl(it.assetId));
        CURRENT = { assetId: it.assetId, index: i, startedAt: Date.now(), url };
        await streamOnce(url, offset);
        offset = 0; // only first item uses offset
      }

      if (mode === 'playthru') {
        console.log('Play-through ended. Sleeping...');
        CURRENT = null;
        await sleep(60000);
        continue;
      }

      // loop: continue from start
      for (let i = 0; i < idx; i++) {
        if (!RUNNING) break;
        const it = items[i];
        const url = it.url || (await presignedUrl(it.assetId));
        CURRENT = { assetId: it.assetId, index: i, startedAt: Date.now(), url };
        await streamOnce(url, 0);
      }
      CURRENT = null;
    } catch (e) {
      console.error('Streamer error', e);
      await sleep(5000);
    }
  }
}

main();
