import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev-server proxy means the browser only ever talks to the Vite origin —
// cookies (the staff session) work the same in dev as they do in
// production, where the backend serves this build's static files directly
// and there's no cross-origin request at all.
//
// base is only set for the production build: this app is served under
// /console (the marketing/patient app in web/ owns '/'), but in dev it's
// still convenient to run at the Vite server's own root.
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  base: command === 'build' ? '/console/' : '/',
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
}));
