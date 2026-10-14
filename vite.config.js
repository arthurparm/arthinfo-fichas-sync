import { defineConfig } from 'vite';

const PRODUCTION_BACKEND_URL = 'https://arthinfo-api.arthur-paraiso-mar.workers.dev';

// FDD-73: a URL do backend vai embutida no build. `vite` (dev) usa localhost:3000;
// `vite build` usa a produção, ou BACKEND_URL se definida.
export default defineConfig(({ command }) => ({
  define: {
    __BACKEND_URL__: JSON.stringify(
      process.env.BACKEND_URL || (command === 'serve' ? 'http://localhost:3000' : PRODUCTION_BACKEND_URL),
    ),
  },
  build: {
    outDir: 'dist',
    lib: {
      entry: 'src/index.js',
      name: 'ArthinfoFichasSync',
      fileName: () => 'module.js',
      formats: ['es']
    }
  }
}));
