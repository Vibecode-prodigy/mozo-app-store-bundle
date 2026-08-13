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
import { readFile, writeFile } from 'node:fs/promises';
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
    const styles = existsSync(path.join(DIST_DIR, STYLE_FILE)) ? [STYLE_FILE] : [];

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
