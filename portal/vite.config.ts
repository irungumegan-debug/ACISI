import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base '/portal/' applies in both dev and build, so React Router's basename
// (import.meta.env.BASE_URL) matches in every environment: the portal is
// always reached at "/portal/...", the same path the backend serves the
// production build from (see src/app.ts) — no dev/prod route mismatch.
export default defineConfig({
  base: '/portal/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
});
