import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    lib: {
      entry: 'src/index.js',
      name: 'ArthinfoFichasSync',
      fileName: () => 'module.js',
      formats: ['es']
    }
  }
});