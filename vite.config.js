import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: Number(process.env.PORT) || 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: Number(process.env.PORT) || 4173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
