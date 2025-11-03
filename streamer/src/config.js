import 'dotenv/config';

const env = (k, d) => process.env[k] ?? d;

export const CONFIG = {
  API_BASE_URL: env('API_BASE_URL', ''),
  API_AUTH_TOKEN: env('API_AUTH_TOKEN', ''),
  CHANNEL: env('CHANNEL', 'default'),
  WEEK: env('WEEK', 'current'),
  RTMP_TARGET: env('RTMP_TARGET', ''),
  VIDEO_BITRATE: env('VIDEO_BITRATE', '2500k'),
  AUDIO_BITRATE: env('AUDIO_BITRATE', '160k'),
  FPS: parseInt(env('FPS', '24'), 10),
  GOP: parseInt(env('GOP', '24'), 10), // 1 second GOP for short videos
  RESOLUTION: env('RESOLUTION', '1280x720'),
  PRESET: env('PRESET', 'ultrafast'),
};

if (!CONFIG.RTMP_TARGET) {
  console.warn('RTMP_TARGET not set. Example: rtmp://live.restream.io/live/<key>');
}
if (!CONFIG.API_BASE_URL) {
  console.warn('API_BASE_URL not set. Set backend URL.');
}

