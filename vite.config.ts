import { defineConfig } from 'vite';

// Relative base: the built app works at a domain root or in a subfolder
// (classic shared hosting such as o2switch).
export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'app-assets',
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    restoreMocks: true,
  },
} as never);
