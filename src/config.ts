export const CONFIG = {
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL || '',
  USE_MOCK_UPLOADS: (import.meta.env.VITE_USE_MOCK_UPLOADS ?? 'true') === 'true',
  USE_BACKEND_SCHEDULE: (import.meta.env.VITE_USE_BACKEND_SCHEDULE ?? 'false') === 'true',
  API_AUTH_TOKEN: import.meta.env.VITE_API_AUTH_TOKEN || '',
  CHANNEL: import.meta.env.VITE_CHANNEL || 'default',
  WEEK: import.meta.env.VITE_WEEK || 'current',
  REALTIME_URL: import.meta.env.VITE_REALTIME_URL || '',
  STREAMER_BASE_URL: import.meta.env.VITE_STREAMER_BASE_URL || '',
};
