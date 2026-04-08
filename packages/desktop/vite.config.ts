import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/main.ts',
        vite: {
          build: {
            outDir: 'dist/main',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      {
        entry: 'src/main/preload.ts',
        vite: {
          build: {
            outDir: 'dist/preload',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
        onstart(args) {
          args.reload();
        },
      },
    ]),
    renderer(),
  ],
  optimizeDeps: {
    include: ['mermaid'],
  },
  build: {
    outDir: 'dist/renderer',
  },
});
