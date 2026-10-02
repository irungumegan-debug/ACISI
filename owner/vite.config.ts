import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Same setup as dashboard/vite.config.ts: the dev-server proxy keeps the
// owner session cookie same-origin, and base is only set for the
// production build, which the backend serves under /owner.
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  base: command === 'build' ? '/owner/' : '/',
  server: {
    port: 5175,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
}));
