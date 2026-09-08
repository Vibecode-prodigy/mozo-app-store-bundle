import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Vite 5 library mode always emits `style.css` and ignores most filename config.
 * The host only injects whatever the manifest lists, and emit-manifest only lists
 * `app.css`. Collapse every emitted stylesheet onto that name before files are written.
 */
function forceAppCss(): Plugin {
    return {
        name: 'mozo-force-app-css',
        generateBundle(_options, bundle) {
            const cssEntries = Object.entries(bundle).filter(
                ([, piece]) => piece.type === 'asset' && piece.fileName.endsWith('.css')
            );

            if (cssEntries.length === 0) {
                this.warn(
                    'No CSS was emitted. The host will mount an unstyled app. ' +
                        'Check that wrap-lovable re-imported the stylesheet from the Lovable shell.'
                );
                return;
            }

            const [firstKey, first] = cssEntries[0];
            if (first.type !== 'asset') return;

            first.fileName = 'app.css';
            first.source = cssEntries
                .map(([, piece]) => {
                    if (piece.type !== 'asset') return '';
                    return typeof piece.source === 'string'
                        ? piece.source
                        : new TextDecoder().decode(piece.source);
                })
                .join('\n');

            if (firstKey !== 'app.css') {
                bundle['app.css'] = first;
                delete bundle[firstKey];
            }

            for (const [key] of cssEntries.slice(1)) {
                delete bundle[key];
            }
        },
    };
}

/**
 * Builds the wrapped app as a single self-contained ES module.
 *
 * React is deliberately *bundled* rather than externalised: the host is a Vue
 * application and does not provide a React runtime, and two apps mounted side by side
 * must not be forced onto the same React version.
 */
export default defineConfig(async ({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
    const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || '';

    if (!supabaseUrl || !supabaseKey) {
        throw new Error(
            'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set for the App Store build. ' +
            'wrap-lovable copies them from the Lovable repo .env; or set them as GitHub Actions secrets.'
        );
    }

    // Tailwind v4 apps ship `@tailwindcss/vite`. v3 apps use PostCSS instead — wrap-lovable
    // copies that config to the build root, so the optional import failing is expected.
    const plugins: Plugin[] = [react(), forceAppCss()];
    try {
        const specifier = '@tailwindcss/vite';
        const { default: tailwindcss } = (await import(specifier)) as { default: () => Plugin };
        plugins.splice(1, 0, tailwindcss());
    } catch {
        // Not installed; PostCSS + tailwind.config (if copied) still apply.
    }

    return {
        plugins,
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
                    assetFileNames: (assetInfo) => {
                        const name = assetInfo.names?.[0] ?? assetInfo.name ?? '';
                        if (name === 'style' || name.endsWith('.css')) return 'app.css';
                        return 'assets/[name]-[hash][extname]';
                    },
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
