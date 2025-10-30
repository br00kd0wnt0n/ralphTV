import 'dotenv/config';

const env = (k, d) => process.env[k] ?? d;

export const CONFIG = {
  API_BASE_URL: env('API_BASE_URL', ''),
  API_AUTH_TOKEN: env('API_AUTH_TOKEN', ''),
  CHANNEL: env('CHANNEL', 'default'),
  WEEK: env('WEEK', 'current'),
  RTMP_TARGET: env('RTMP_TARGET', ''),
  VIDEO_BITRATE: env('VIDEO_BITRATE', '4500k'),
  AUDIO_BITRATE: env('AUDIO_BITRATE', '160k'),
  FPS: parseInt(env('FPS', '30'), 10),
  GOP: parseInt(env('GOP', '60'), 10),
  RESOLUTION: env('RESOLUTION', '1920x1080'),
  PRESET: env('PRESET', 'veryfast'),
};

if (!CONFIG.RTMP_TARGET) {
  console.warn('RTMP_TARGET not set. Example: rtmp://live.restream.io/live/<key>');
}
if (!CONFIG.API_BASE_URL) {
  console.warn('API_BASE_URL not set. Set backend URL.');
}

