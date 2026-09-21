import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Same dev-proxy pattern as dashboard/vite.config.ts — the browser only
// ever talks to the Vite origin, so cookies (patient/staff session) behave
// the same in dev as in production, where the backend serves this build's
// static files directly from '/' with no cross-origin request at all.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
});
