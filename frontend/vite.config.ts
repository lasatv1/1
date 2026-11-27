/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // GitHub Pages project sites live under /<repo>/; set VITE_BASE=/<repo>/ when building for it.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      // Backend (FastAPI). API keys live only on the backend.
      '/api': { target: process.env.VITE_API_PROXY ?? 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('@react-three') || id.includes('three-conic')) return 'three';
          if (id.includes('node_modules/d3-') || id.includes('topojson')) return 'geo';
          return undefined;
        },
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
