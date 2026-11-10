import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * GitHub Pages answers a path it has no file for with 404.html. A copy of the app there means a
 * deep link or a reload lands on its own page instead of the host's error page.
 */
function pagesFallback(): Plugin {
  let out = '';
  return {
    name: 'evalbench:pages-fallback',
    apply: 'build',
    configResolved(config) {
      out = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      copyFileSync(resolve(out, 'index.html'), resolve(out, '404.html'));
    },
  };
}

/** The server build must not ship the demo's adapter or its sample data: stop if either gets in. */
function noDemoCode(): Plugin {
  return {
    name: 'evalbench:no-demo-code',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        const leaked = chunk.type === 'chunk' && Object.keys(chunk.modules).find((id) => id.includes('/src/demo/'));
        if (leaked) this.error(`the server build bundled ${leaked}; only a demo build (--mode demo) may load src/demo`);
      }
    },
  };
}

// Two builds from one source:
//   npm run build        the app the Python server ships, written into the package (evalbench/static)
//   npm run build:demo   the static demo for GitHub Pages, written to web/dist: the same pages,
//                        answering from sample data in the browser (src/demo), under /evalbench/
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  const base = `${(process.env.BASE_PATH || '/evalbench').replace(/\/+$/, '')}/`;
  return {
    plugins: [react(), tailwindcss(), demo ? pagesFallback() : noDemoCode()],
    base: demo ? base : '/',
    // Always a literal, so the server build drops every demo branch and never bundles src/demo.
    define: { 'import.meta.env.VITE_DEMO': JSON.stringify(demo ? '1' : '') },
    build: { outDir: demo ? 'dist' : '../evalbench/static', emptyOutDir: true, chunkSizeWarningLimit: 900 },
    server: { proxy: { '/api': 'http://127.0.0.1:8484' } },
    test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
  };
});
