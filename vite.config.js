import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5174,
    host: true,
  },
  build: {
    rollupOptions: {
      input: {
        main:     resolve(__dirname, 'index.html'),
        about:    resolve(__dirname, 'about/index.html'),
        projects: resolve(__dirname, 'projects/index.html'),
      },
    },
  },
});
