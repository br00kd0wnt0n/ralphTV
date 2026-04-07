// Ensure URL has protocol (https:// or http://)
function ensureProtocol(url: string): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  // Default to https:// for production URLs
  return `https://${url}`;
}

// Ensure WebSocket URL has protocol (wss:// or ws://)
function ensureWsProtocol(url: string): string {
  if (!url) return '';
  if (url.startsWith('ws://') || url.startsWith('wss://')) return url;
  // Default to wss:// (secure) for production URLs
  return `wss://${url}`;
}

export const CONFIG = {
  API_BASE_URL: ensureProtocol(import.meta.env.VITE_API_BASE_URL || ''),
  USE_MOCK_UPLOADS: (import.meta.env.VITE_USE_MOCK_UPLOADS ?? 'true') === 'true',
  USE_BACKEND_SCHEDULE: (import.meta.env.VITE_USE_BACKEND_SCHEDULE ?? 'false') === 'true',
  // Fallback token used when no login session exists (e.g. embed pages).
  // WARNING: This is embedded in client-side JS and visible to all users.
  API_AUTH_TOKEN: import.meta.env.VITE_API_AUTH_TOKEN || '',
  CHANNEL: import.meta.env.VITE_CHANNEL || 'default',
  WEEK: import.meta.env.VITE_WEEK || 'current',
  REALTIME_URL: ensureWsProtocol(import.meta.env.VITE_REALTIME_URL || ''),
  STREAMER_BASE_URL: ensureProtocol(import.meta.env.VITE_STREAMER_BASE_URL || ''),
  RELAY_BASE_URL: ensureProtocol(import.meta.env.VITE_RELAY_BASE_URL || ''),
  RELAY_LANDSCAPE_PATH: import.meta.env.VITE_RELAY_LANDSCAPE_PATH || '/hls/stream.m3u8',
  RELAY_PORTRAIT_PATH: import.meta.env.VITE_RELAY_PORTRAIT_PATH || '/hls/stream_portrait.m3u8',
  FALLBACK_GIF_URL: ensureProtocol(import.meta.env.VITE_FALLBACK_GIF_URL || ''),
  DISABLE_AUTH: (import.meta.env.VITE_DISABLE_AUTH ?? 'false') === 'true'
};
