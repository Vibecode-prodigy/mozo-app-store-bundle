import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Builds the wrapped app as a single self-contained ES module.
 *
 * React is deliberately *bundled* rather than externalised: the host is a Vue
 * application and does not provide a React runtime, and two apps mounted side by side
 * must not be forced onto the same React version.
 */
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            // Lovable projects import their own code as "@/…".
            '@': resolve(__dirname, 'app/src'),
            '@mozo/app': resolve(__dirname, 'src/main.tsx'),
        },
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        // Host pages are modern-browser only; keeping esnext avoids shipping helpers
        // that would be duplicated across every installed app.
        target: 'esnext',
        cssCodeSplit: false,
        sourcemap: true,
        lib: {
            entry: resolve(__dirname, 'src/main.tsx'),
            formats: ['es'],
            fileName: () => 'app.js',
        },
        rollupOptions: {
            output: {
                assetFileNames: (assetInfo) =>
                    assetInfo.name?.endsWith('.css') ? 'app.css' : 'assets/[name]-[hash][extname]',
                // A single chunk keeps the manifest's `module` entry the only script the
                // host has to load; dynamic imports inside the app still split normally.
                chunkFileNames: 'assets/[name]-[hash].js',
                inlineDynamicImports: true,
            },
        },
    },
    define: {
        // Lovable apps assume a Vite app shell; without this, libraries that branch on
        // NODE_ENV break when bundled in library mode.
        'process.env.NODE_ENV': JSON.stringify('production'),
    },
});
