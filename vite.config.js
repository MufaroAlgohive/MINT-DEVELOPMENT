import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// `command` is 'serve' for the dev server and 'build' for production builds.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: '/',
  // In the PRODUCTION bundle, strip the noisy debug logs (console.log/info/
  // debug/trace) so users don't see internal state in devtools — but KEEP
  // console.warn / console.error for genuine problems. Marking the noisy calls
  // `pure` lets the default esbuild minifier dead-code-eliminate them.
  // Note: failed-request logs (e.g. "GET …404") are emitted by the browser
  // itself, not console.*, so they always remain visible. Dev keeps everything;
  // server/serverless code (api/, server/) is untouched (Vite only bundles the
  // browser app).
  esbuild: command === 'build'
    ? { pure: ['console.log', 'console.info', 'console.debug', 'console.trace'], drop: ['debugger'] }
    : {},
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    exclude: ['@lottiefiles/dotlottie-react'],
  },
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 5000,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err, req, res) => {
            console.warn('[vite-proxy] /api error:', err.message);
            if (!res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'API server unavailable', detail: err.message }));
            }
          });
        },
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-framer': ['framer-motion'],
          'vendor-recharts': ['recharts'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-lucide': ['lucide-react'],
        },
      },
    },
  },
}));
