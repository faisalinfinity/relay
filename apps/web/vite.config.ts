import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = process.env.RELAY_API_URL ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same origin as the UI, so no CORS and the WebSocket URL is just /ws
    proxy: {
      '/api': API,
      '/webhooks': API,
      '/ws': { target: API.replace(/^http/, 'ws'), ws: true },
    },
  },
});
