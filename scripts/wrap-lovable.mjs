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

/**
 * Server-only trees. They live in `src/` so TanStack's generated `routeTree.gen.ts`
 * imports them, but they must not pull Cloudflare/Node runtimes into the client bundle.
 * Paths are posix, relative to the app `src/` directory.
 */
const SERVER_ONLY_PREFIXES = [
    'lib/mcp',
    'routes/mcp.ts',
    'routes/[.mcp]',
    'routes/[.well-known]',
    'routes/api',
    'routes/lovable',
];

const toPosix = (value) => value.split(path.sep).join('/');

const isServerOnly = (relPosix) =>
    SERVER_ONLY_PREFIXES.some(
        (prefix) => relPosix === prefix || relPosix.startsWith(`${prefix}/`)
    );

const walkFiles = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...(await walkFiles(full)));
        else files.push(full);
    }
    return files;
};

/**
 * Keep `routeTree.gen.ts` resolvable, but strip server handlers (MCP, /api/mozo, email)
 * so Vite never follows `@lovable.dev/mcp-js` or createServerFn into the client bundle.
 */
const stubServerOnlyModules = async () => {
    const files = await walkFiles(APP_SRC_DIR);
    let stubbed = 0;
    for (const file of files) {
        const rel = toPosix(path.relative(APP_SRC_DIR, file));
        if (!isServerOnly(rel)) continue;
        if (rel === 'lib/mcp' || rel.startsWith('lib/mcp/')) continue;
        if (!/\.(tsx|ts|jsx|js)$/.test(file)) continue;

        const original = await readFile(file, 'utf8');
        const match = original.match(/createFileRoute\(\s*(['"`])([^'"`]+)\1\s*\)/);
        if (!match) continue;

        await writeFile(
            file,
            [
                '// Stubbed by wrap-lovable.mjs — server-only route, not part of the client bundle.',
                "import { createFileRoute } from '@tanstack/react-router';",
                `export const Route = createFileRoute('${match[2]}')({});`,
                '',
            ].join('\n')
        );
        stubbed += 1;
    }

    await rm(path.join(APP_SRC_DIR, 'lib', 'mcp'), { recursive: true, force: true });
    console.log(`wrap-lovable: stubbed ${stubbed} server-only routes; removed lib/mcp`);
};

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
 * The Lovable app's Vite env (VITE_SUPABASE_URL, …) lives next to its package.json,
 * not in src/. Copy it to the boilerplate root so `vite build` can inline it.
 */
const copyEnvFiles = async (fromDir) => {
    const names = ['.env', '.env.production', '.env.local'];
    let copied = 0;
    for (const name of names) {
        const from = path.join(fromDir, name);
        if (!existsSync(from)) continue;
        await cp(from, path.join(ROOT, name));
        copied += 1;
    }
    console.log(
        copied > 0
            ? `wrap-lovable: copied ${copied} env file(s) for the client build`
            : 'wrap-lovable: no .env next to the Lovable app; set VITE_SUPABASE_* in CI'
    );
};

/**
 * Standalone-product packages that must not land in the wrap install.
 * @tanstack/react-start (and friends) require vite>=7; this boilerplate pins
 * vite@5, so merging them makes `npm install` fail with ERESOLVE.
 */
const WRAP_EXCLUDED_PACKAGES = new Set([
    '@tanstack/react-start',
    '@tanstack/router-plugin',
    '@lovable.dev/mcp-js',
    '@lovable.dev/email-js',
    '@lovable.dev/webhooks-js',
    '@lovable.dev/vite-tanstack-config',
    'nitro',
]);

const omitWrapExcluded = (deps = {}) =>
    Object.fromEntries(Object.entries(deps).filter(([name]) => !WRAP_EXCLUDED_PACKAGES.has(name)));

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

    const appDependencies = omitWrapExcluded(appPackage.dependencies);
    const appDevDependencies = omitWrapExcluded(appPackage.devDependencies);
    const omitted = [
        ...Object.keys(appPackage.dependencies ?? {}),
        ...Object.keys(appPackage.devDependencies ?? {}),
    ].filter((name) => WRAP_EXCLUDED_PACKAGES.has(name));

    const merged = {
        ...boilerplatePackage,
        dependencies: {
            ...boilerplatePackage.dependencies,
            ...appDependencies,
        },
        devDependencies: {
            ...boilerplatePackage.devDependencies,
            ...appDevDependencies,
            // The boilerplate owns the build toolchain; the app must not downgrade it.
            vite: boilerplatePackage.devDependencies.vite,
            typescript: boilerplatePackage.devDependencies.typescript,
            '@vitejs/plugin-react': boilerplatePackage.devDependencies['@vitejs/plugin-react'],
        },
    };

    await writeFile(boilerplatePackagePath, `${JSON.stringify(merged, null, 2)}\n`);
    console.log(
        omitted.length > 0
            ? `wrap-lovable: merged app dependencies into package.json (omitted ${omitted.join(', ')})`
            : 'wrap-lovable: merged app dependencies into package.json',
    );
};

/**
 * PostCSS / Tailwind config lives next to the Lovable package.json, not in src/.
 * Copy it to the boilerplate root so `vite build` can expand utilities. Content globs
 * that pointed at `./src/` are rewritten to `./app/src/` (where wrap copies the app).
 */
const STYLE_TOOLING_FILES = [
    'postcss.config.js',
    'postcss.config.cjs',
    'postcss.config.mjs',
    'postcss.config.ts',
    'tailwind.config.js',
    'tailwind.config.cjs',
    'tailwind.config.mjs',
    'tailwind.config.ts',
];

const copyStyleTooling = async () => {
    let copied = 0;
    for (const name of STYLE_TOOLING_FILES) {
        const from = path.join(sourceDir, name);
        if (!existsSync(from)) continue;
        let text = await readFile(from, 'utf8');
        if (name.startsWith('tailwind.config')) {
            text = text.replaceAll('./src/', './app/src/').replace(/(['"])src\//g, '$1app/src/');
        }
        await writeFile(path.join(ROOT, name), text);
        copied += 1;
    }
    console.log(
        copied > 0
            ? `wrap-lovable: copied ${copied} CSS tooling file(s) to the build root`
            : 'wrap-lovable: no PostCSS/Tailwind config in the Lovable app'
    );
};

const CSS_FROM_JS = /(?:import\s+['"]([^'"]+\.css)['"]|from\s+['"]([^'"]+\.css)['"])/g;
const CSS_FROM_HTML = /<link[^>]+href=["']([^"']+\.css)["']/gi;
const WELL_KNOWN_STYLES = ['index.css', 'globals.css', 'App.css', 'styles.css', 'app.css'];

/** Collect CSS specifiers to re-import from app/entry.ts after dropping the standalone shell. */
const collectStyleSpecs = async () => {
    const specs = new Set();

    const addFromAbs = (absPath) => {
        const rel = toPosix(path.relative(sourceSrcDir, absPath));
        if (!rel || rel.startsWith('../')) return;
        specs.add(`./src/${rel}`);
    };

    const addFromSpec = (spec, importerDir) => {
        if (spec.startsWith('.')) {
            addFromAbs(path.resolve(importerDir, spec));
            return;
        }
        if (spec.startsWith('/')) {
            addFromAbs(path.resolve(sourceDir, spec.slice(1)));
            return;
        }
        specs.add(spec);
    };

    const scanJs = async (filePath, importerDir) => {
        if (!existsSync(filePath)) return;
        const text = await readFile(filePath, 'utf8');
        for (const match of text.matchAll(CSS_FROM_JS)) {
            addFromSpec(match[1] || match[2], importerDir);
        }
    };

    for (const name of ['main.tsx', 'main.ts', 'main.jsx', 'main.js']) {
        await scanJs(path.join(sourceSrcDir, name), sourceSrcDir);
    }

    const indexHtml = path.join(sourceDir, 'index.html');
    if (existsSync(indexHtml)) {
        const text = await readFile(indexHtml, 'utf8');
        for (const match of text.matchAll(CSS_FROM_HTML)) {
            addFromSpec(match[1], sourceDir);
        }
    }

    for (const name of WELL_KNOWN_STYLES) {
        if (existsSync(path.join(APP_SRC_DIR, name))) {
            specs.add(`./src/${name}`);
        }
    }

    return [...specs];
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

    await stubServerOnlyModules();
    await copyEnvFiles(sourceDir);
    await copyStyleTooling();

    // Lovable apps import their global stylesheet from main.tsx / index.html, which we
    // dropped as part of the shell. Re-import those stylesheets here so Vite emits app.css.
    const styleSpecs = await collectStyleSpecs();
    const styleImports = styleSpecs.map((spec) => `import '${spec}';`).join('\n');
    console.log(
        styleSpecs.length > 0
            ? `wrap-lovable: re-imported ${styleSpecs.length} stylesheet(s): ${styleSpecs.join(', ')}`
            : 'wrap-lovable: no stylesheet found to re-import; the bundle will ship unstyled'
    );

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
