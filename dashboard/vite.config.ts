import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev-server proxy means the browser only ever talks to the Vite origin —
// cookies (the staff session) work the same in dev as they do in
// production, where the backend serves this build's static files directly
// and there's no cross-origin request at all.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
});
