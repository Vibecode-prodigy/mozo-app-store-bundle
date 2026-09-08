#!/usr/bin/env node
/**
 * Step 7 of the pipeline: emit dist/manifest.json describing the build output.
 *
 * Takes the developer-authored metadata from mozo.app.json and fills in the parts only
 * the build knows: which files Vite actually produced, and which commit they came from.
 * Every path it declares is verified to exist, because the API rejects a manifest that
 * points at a file the bundle does not contain.
 */

import { existsSync } from 'node:fs';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const CONFIG_PATH = path.join(ROOT, 'mozo.app.json');

const MANIFEST_VERSION = 1;
const MODULE_FILE = 'app.js';
const STYLE_FILE = 'app.css';

const fail = (message) => {
    console.error(`emit-manifest: ${message}`);
    process.exit(1);
};

const listCssFiles = async (dir, rel = '') => {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const relative = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            files.push(...(await listCssFiles(path.join(dir, entry.name), relative)));
        } else if (entry.name.endsWith('.css')) {
            files.push(relative);
        }
    }
    return files;
};

/** Vite 5 lib mode emits style.css; the host only loads app.css. Rename if needed. */
const ensureAppCss = async () => {
    const appCssPath = path.join(DIST_DIR, STYLE_FILE);
    if (existsSync(appCssPath)) return true;

    const cssFiles = await listCssFiles(DIST_DIR);
    if (cssFiles.length === 0) return false;

    const preferred =
        cssFiles.find((name) => name === 'style.css') ??
        cssFiles.find((name) => !name.includes('/')) ??
        cssFiles[0];

    await rename(path.join(DIST_DIR, preferred), appCssPath);
    console.log(`emit-manifest: renamed dist/${preferred} → dist/${STYLE_FILE}`);
    return true;
};

const main = async () => {
    if (!existsSync(CONFIG_PATH)) {
        fail('mozo.app.json not found — it defines the app name, slug and entry points.');
    }

    if (!existsSync(path.join(DIST_DIR, MODULE_FILE))) {
        fail(`dist/${MODULE_FILE} not found — run "vite build" before emitting the manifest.`);
    }

    const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));

    if (!Array.isArray(config.entrypoints) || config.entrypoints.length === 0) {
        fail('mozo.app.json must declare at least one entry point.');
    }

    // The library build emits one module and at most one stylesheet, so every declared
    // entry point points at the same files and is distinguished by its slot.
    // Vite 5 lib mode names that file style.css; force it onto app.css so the host loads it.
    const styles = (await ensureAppCss()) ? [STYLE_FILE] : [];
    if (styles.length === 0) {
        console.warn(
            'emit-manifest: no stylesheet in dist/; the host will mount the app unstyled.'
        );
    }

    const manifest = {
        manifest_version: MANIFEST_VERSION,
        name: config.name,
        slug: config.slug ?? null,
        version: config.version,
        entrypoints: config.entrypoints.map((entrypoint) => ({
            name: entrypoint.name,
            slot: entrypoint.slot ?? null,
            module: MODULE_FILE,
            styles,
        })),
        scopes: config.scopes ?? [],
        external_backend: config.external_backend ?? null,
        external_backends: config.external_backends ?? [],
        source: {
            // Populated by the GitHub Action; absent for local builds.
            repository: process.env.MOZO_SOURCE_REPOSITORY ?? null,
            commit: process.env.MOZO_SOURCE_COMMIT ?? null,
        },
    };

    for (const field of ['name', 'version']) {
        if (!manifest[field]) fail(`mozo.app.json is missing "${field}".`);
    }

    await writeFile(path.join(DIST_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    console.log(
        `emit-manifest: wrote dist/manifest.json ` +
        `(${manifest.entrypoints.length} entry point(s), ${styles.length ? 'with' : 'no'} stylesheet)`
    );
};

main().catch((error) => {
    console.error('emit-manifest failed:', error);
    process.exit(1);
});
