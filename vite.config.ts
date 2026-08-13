import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Charting and the Supabase client are large and change far less often
        // than application code, so splitting them keeps the cacheable vendor
        // chunks stable across deploys.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: false,
    // Playwright specs live in e2e/ and must not be picked up by Vitest.
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      // Pure financial domain modules shared with the Edge Functions. They
      // contain no Deno APIs, so the same tests run here and in CI.
      'supabase/functions/_shared/financial/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/financial/**', 'src/features/**'],
    },
  },
});
