import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  preview: {
    allowedHosts: [
      'ralphtv-production.up.railway.app',
      '.up.railway.app', // Allow all Railway domains
    ],
  },
});

