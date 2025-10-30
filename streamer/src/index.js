import { spawn } from 'node:child_process';
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
  const u = `${CONFIG.API_BASE_URL}/feed/${encodeURIComponent(CONFIG.CHANNEL)}/${encodeURIComponent(CONFIG.WEEK)}/today/playlist`;
  // fall back to exact day if /today not implemented
  const today = new Date();
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const day = days[today.getDay()];
  const legacy = `${CONFIG.API_BASE_URL}/feed/${encodeURIComponent(CONFIG.CHANNEL)}/${encodeURIComponent(CONFIG.WEEK)}/${day}/playlist`;
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

async function streamOnce(url, offsetSec) {
  return new Promise((resolve, reject) => {
    const args = ffmpegArgs(url, offsetSec);
    console.log('ffmpeg', args.join(' '));
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => process.stdout.write(d.toString()));
    child.stderr.on('data', (d) => process.stderr.write(d.toString()));
    child.on('exit', (code) => {
      if (code === 0) resolve(); else reject(new Error(`ffmpeg exited ${code}`));
    });
  });
}

async function main() {
  if (!CONFIG.API_BASE_URL || !CONFIG.RTMP_TARGET) {
    console.error('Missing API_BASE_URL or RTMP_TARGET');
    process.exit(1);
  }

  // Loop forever
  // At start of each cycle, compute pointer and decide list
  for (;;) {
    try {
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
        const it = items[i];
        const url = await presignedUrl(it.assetId);
        await streamOnce(url, offset);
        offset = 0; // only first item uses offset
      }

      if (mode === 'playthru') {
        console.log('Play-through ended. Sleeping...');
        await sleep(60000);
        continue;
      }

      // loop: continue from start
      for (let i = 0; i < idx; i++) {
        const it = items[i];
        const url = await presignedUrl(it.assetId);
        await streamOnce(url, 0);
      }
    } catch (e) {
      console.error('Streamer error', e);
      await sleep(5000);
    }
  }
}

main();

