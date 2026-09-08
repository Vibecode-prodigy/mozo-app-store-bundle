#!/usr/bin/env node
/**
 * Fails the CI build when Vite did not emit a compiled stylesheet as dist/app.css.
 * The host only injects that file; a missing or unprocessed CSS bundle ships unstyled.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const CSS_PATH = path.join(ROOT, 'dist', 'app.css');

const fail = (message) => {
    console.error(`verify-styles: ${message}`);
    process.exit(1);
};

if (!existsSync(CSS_PATH)) {
    fail(
        'dist/app.css is missing. wrap-lovable must re-import the global stylesheet ' +
            '(keep `import "./index.css"` / `import "./styles.css"` on the app entry).'
    );
}

const css = await readFile(CSS_PATH, 'utf8');
if (css.trim().length < 80) {
    fail('dist/app.css is empty or too small to be compiled CSS.');
}

if (/@tailwind\s+(base|components|utilities)/.test(css) && !css.includes('{')) {
    fail('dist/app.css still contains unprocessed @tailwind directives.');
}

console.log('verify-styles: dist/app.css is compiled');
