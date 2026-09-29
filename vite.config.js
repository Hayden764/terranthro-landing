import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import copyEditor from './tools/editor-plugin.js';

export default defineConfig({
  // dev-server only: in-page copy editor (apply: 'serve'), absent from builds
  plugins: [copyEditor()],
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
