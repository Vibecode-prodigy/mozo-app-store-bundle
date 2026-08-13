#!/usr/bin/env node
/**
 * Step 4 of the pipeline: copy a Lovable app into the boilerplate.
 *
 * Reads the app from --source (default ./lovable-app, i.e. the checked-out Lovable
 * GitHub repository), copies its source tree into app/src, and writes app/entry.ts
 * re-exporting the app's root component as the default export.
 *
 * The Lovable app keeps its own `main.tsx`/`index.html`, but those are the *standalone*
 * shell — they call createRoot() on #root and would fight the host. We deliberately
 * ignore them and mount the root component ourselves.
 */

import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const APP_DIR = path.join(ROOT, 'app');
const APP_SRC_DIR = path.join(APP_DIR, 'src');

/** Files from the Lovable app that belong to its standalone shell, not to the component. */
const SHELL_FILES = new Set(['main.tsx', 'main.ts', 'main.jsx', 'main.js', 'vite-env.d.ts']);

/** Candidate root components, most specific first. */
const ROOT_COMPONENT_CANDIDATES = ['App.tsx', 'App.jsx', 'app.tsx', 'App.ts'];

const parseArgs = () => {
    const args = new Map();
    for (let i = 2; i < process.argv.length; i += 1) {
        const arg = process.argv[i];
        if (!arg.startsWith('--')) continue;
        const [key, inlineValue] = arg.slice(2).split('=');
        args.set(key, inlineValue ?? process.argv[++i]);
    }
    return args;
};

const args = parseArgs();
const sourceDir = path.resolve(ROOT, args.get('source') ?? 'lovable-app');

if (!existsSync(sourceDir)) {
    console.error(
        `wrap-lovable: source directory not found: ${sourceDir}\n` +
        `Clone the Lovable GitHub repository there, or pass --source <path>.`
    );
    process.exit(1);
}

const sourceSrcDir = existsSync(path.join(sourceDir, 'src'))
    ? path.join(sourceDir, 'src')
    : sourceDir;

/** Find the app's root component relative to its src directory. */
const findRootComponent = async () => {
    const entries = await readdir(sourceSrcDir, { withFileTypes: true });
    const fileNames = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));

    for (const candidate of ROOT_COMPONENT_CANDIDATES) {
        if (fileNames.has(candidate)) return candidate;
    }

    return null;
};

/**
 * Merge the Lovable app's runtime dependencies into the boilerplate's package.json so
 * `npm ci` in CI installs everything the app imports. Versions from the app win — it was
 * developed and tested against them.
 */
const mergeDependencies = async () => {
    const appPackagePath = path.join(sourceDir, 'package.json');
    if (!existsSync(appPackagePath)) {
        console.warn('wrap-lovable: the source app has no package.json; skipping dependency merge.');
        return;
    }

    const boilerplatePackagePath = path.join(ROOT, 'package.json');
    const [appPackage, boilerplatePackage] = await Promise.all([
        readFile(appPackagePath, 'utf8').then(JSON.parse),
        readFile(boilerplatePackagePath, 'utf8').then(JSON.parse),
    ]);

    const merged = {
        ...boilerplatePackage,
        dependencies: {
            ...boilerplatePackage.dependencies,
            ...appPackage.dependencies,
        },
        devDependencies: {
            ...boilerplatePackage.devDependencies,
            ...appPackage.devDependencies,
            // The boilerplate owns the build toolchain; the app must not downgrade it.
            vite: boilerplatePackage.devDependencies.vite,
            typescript: boilerplatePackage.devDependencies.typescript,
            '@vitejs/plugin-react': boilerplatePackage.devDependencies['@vitejs/plugin-react'],
        },
    };

    await writeFile(boilerplatePackagePath, `${JSON.stringify(merged, null, 2)}\n`);
    console.log('wrap-lovable: merged app dependencies into package.json');
};

const main = async () => {
    const rootComponent = await findRootComponent();
    if (!rootComponent) {
        console.error(
            `wrap-lovable: could not find a root component in ${sourceSrcDir}.\n` +
            `Expected one of: ${ROOT_COMPONENT_CANDIDATES.join(', ')}`
        );
        process.exit(1);
    }

    await rm(APP_SRC_DIR, { recursive: true, force: true });
    await mkdir(APP_SRC_DIR, { recursive: true });

    await cp(sourceSrcDir, APP_SRC_DIR, {
        recursive: true,
        filter: (src) => !SHELL_FILES.has(path.basename(src)),
    });

    // Lovable apps import their global stylesheet from main.tsx, which we dropped as part
    // of the shell. Re-import it here so Vite still emits it into app.css.
    const styleImports = ['index.css', 'globals.css', 'App.css']
        .filter((styleFile) => existsSync(path.join(APP_SRC_DIR, styleFile)))
        .map((styleFile) => `import './src/${styleFile}';`)
        .join('\n');

    const componentModule = `./src/${rootComponent.replace(/\.(tsx|ts|jsx|js)$/, '')}`;

    await writeFile(
        path.join(APP_DIR, 'entry.ts'),
        [
            '// Generated by scripts/wrap-lovable.mjs — do not edit by hand.',
            '// Re-exports the Lovable app\'s root component for the boilerplate to mount.',
            styleImports,
            `export { default } from '${componentModule}';`,
            '',
        ].filter(Boolean).join('\n')
    );

    await mergeDependencies();

    console.log(`wrap-lovable: wrapped ${rootComponent} from ${sourceSrcDir}`);
};

main().catch((error) => {
    console.error('wrap-lovable failed:', error);
    process.exit(1);
});
