#!/usr/bin/env node
/**
 * Zip dist/ into bundle.zip for upload to the App Store.
 *
 * The API validates every path in the archive, so this deliberately zips the *contents*
 * of dist/ rather than the directory itself — manifest.json must sit at the archive root.
 */

import { createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import archiver from 'archiver';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const OUTPUT_PATH = path.join(ROOT, 'bundle.zip');

if (!existsSync(path.join(DIST_DIR, 'manifest.json'))) {
    console.error('package-bundle: dist/manifest.json not found — run "npm run build" first.');
    process.exit(1);
}

const output = createWriteStream(OUTPUT_PATH);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
    console.log(`package-bundle: wrote bundle.zip (${archive.pointer()} bytes)`);
});

archive.on('warning', (error) => {
    if (error.code === 'ENOENT') {
        console.warn('package-bundle:', error.message);
        return;
    }
    throw error;
});

archive.on('error', (error) => {
    console.error('package-bundle failed:', error);
    process.exit(1);
});

archive.pipe(output);
archive.directory(DIST_DIR, false);
await archive.finalize();
