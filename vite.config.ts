import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/**
 * Builds the wrapped app as a single self-contained ES module.
 *
 * React is deliberately *bundled* rather than externalised: the host is a Vue
 * application and does not provide a React runtime, and two apps mounted side by side
 * must not be forced onto the same React version.
 */
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
    const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || '';

    if (!supabaseUrl || !supabaseKey) {
        throw new Error(
            'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set for the App Store build. ' +
            'wrap-lovable copies them from the Lovable repo .env; or set them as GitHub Actions secrets.'
        );
    }

    return {
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
            sourcemap: false,
            lib: {
                entry: resolve(__dirname, 'src/main.tsx'),
                formats: ['es'],
                fileName: () => 'app.js',
            },
            rollupOptions: {
                // Server-only builtins that deps may still pull in (mcp-js → cloudflare:workers,
                // sunmi.functions → node:crypto). wrap-lovable stubs those modules out of the
                // graph; this is the safety net so Rollup does not fail the build.
                external: ['cloudflare:workers', 'node:crypto'],
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
            // The generated supabase client falls back to process.env.*; without these
            // replacements the browser hits a missing `process` and crashes.
            'process.env.SUPABASE_URL': JSON.stringify(supabaseUrl),
            'process.env.SUPABASE_PUBLISHABLE_KEY': JSON.stringify(supabaseKey),
            'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
            'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(supabaseKey),
        },
    };
});
