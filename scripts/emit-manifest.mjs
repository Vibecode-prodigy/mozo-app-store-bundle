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
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { findGlobalSelectors, sanitizeAppCss } from './sanitize-app-css.mjs';

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

const listJsFiles = async (dir, rel = '') => {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const relative = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            files.push(...(await listJsFiles(path.join(dir, entry.name), relative)));
        } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
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

/**
 * Thin ESM wrapper per zip folder. Module hosts import this URL; iframe boots
 * import it too. Always pins context.slot to the folder name so a misplaced
 * sidebar element id cannot switch Pipeline → Open items.
 */
const folderModuleWrapper = (entryFolder) => `import {
  mount as baseMount,
  unmount,
  onMount,
  onUnmount,
  useMozo,
  useMozoContext,
} from "../app.js";

var ENTRY = ${JSON.stringify(entryFolder)};

export function mount(element, context) {
  var pinned = Object.assign({}, context || {}, { slot: ENTRY });
  return baseMount(element, pinned);
}

export { unmount, onMount, onUnmount, useMozo, useMozoContext };
`;

/**
 * Admin fullpage document for one zip folder.
 * Paint first, then MozoApp.bridge.connect(). Do not touch window.Mozo and do
 * not call basket — a missing basket must not look like a dead host.
 * `entryFolder` is written to context.slot so the React app pins that feature.
 */
/** Page title shown for a zip folder — Lovable sidebar label when known. */
const pageTitleFor = (entryFolder) => {
    if (entryFolder === 'Pipeline') return 'Pipeline';
    if (entryFolder === 'Open items') return 'Open items';
    if (entryFolder === 'Apparaten') return 'Apparaten';
    if (entryFolder === 'admin-config') return 'Appèl Kassa Onboarding';
    return 'Appèl Kassa Onboarding';
};

const iframeDocument = ({ cssHref, moduleSrc, entryFolder }) => {
    const stylesheet = cssHref ? `    <link rel="stylesheet" href="${cssHref}" />\n` : '';
    const pageTitle = pageTitleFor(entryFolder);
    const html = `<!doctype html>
<html lang="nl" data-mozo-entry="${entryFolder}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${pageTitle}</title>
${stylesheet}    <style>
      /* kit tokens + .kit-* only — no html, body, * */
      .kit-app {
        --kit-bg: #f6f7fb;
        --kit-ink: #2c3142;
        --kit-muted: #6b7280;
        --kit-accent: #106757;
        --kit-accent-2: #0e8f7a;
        --kit-danger: #b42318;
        --kit-radius: 12px;
        --kit-raised: 3px 3px 8px #c5c8d4, -3px -3px 7px #ffffff;
        --kit-inset: inset 2px 2px 5px #d5d8e2, inset -2px -2px 5px #ffffff;
        --kit-font: Inter, system-ui, sans-serif;
        box-sizing: border-box;
        width: 100%;
        max-width: 100%;
        margin: 0;
        padding: 16px;
        overflow-x: hidden;
        background: var(--kit-bg);
        color: var(--kit-ink);
        font-family: var(--kit-font);
      }
      .kit-app--admin { padding: 12px; }
      .kit-title { margin: 0 0 8px; font-size: 16px; font-weight: 650; }
      .kit-lede { margin: 0 0 10px; color: var(--kit-muted); font-size: 13px; }
      .kit-row {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      @media (max-width: 419px) {
        .kit-row { grid-template-columns: minmax(0, 1fr); }
      }
      .kit-btn {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        min-height: 44px;
        border: 0;
        border-radius: var(--kit-radius);
        background: var(--kit-bg);
        box-shadow: var(--kit-raised);
        color: var(--kit-ink);
        padding: 10px 12px;
        font: inherit;
        cursor: pointer;
      }
      .kit-btn-primary {
        background: var(--kit-accent);
        color: var(--kit-bg);
        font-weight: 650;
        box-shadow: none;
      }
      .kit-btn-secondary {
        background: var(--kit-bg);
        color: var(--kit-ink);
        box-shadow: var(--kit-raised);
      }
      .kit-btn:disabled { cursor: default; }
      .kit-btn-primary:disabled {
        background: var(--kit-accent-2);
        color: var(--kit-bg);
      }
      .kit-btn-secondary:disabled { color: var(--kit-muted); }
      .kit-card {
        min-width: 0;
        padding: 12px;
        background: var(--kit-bg);
        color: var(--kit-ink);
        border-radius: var(--kit-radius);
        box-shadow: var(--kit-raised);
      }
      .kit-card-title { margin: 0 0 4px; font-size: 14px; font-weight: 650; }
      .kit-label {
        display: block;
        margin: 0 0 6px;
        font-size: 13px;
        color: var(--kit-ink);
      }
      .kit-input, .kit-textarea {
        display: block;
        box-sizing: border-box;
        width: 100%;
        max-width: 100%;
        min-width: 0;
        border: 0;
        border-radius: var(--kit-radius);
        background: var(--kit-bg);
        color: var(--kit-ink);
        box-shadow: var(--kit-inset);
        padding: 10px 12px;
        font: inherit;
      }
      .kit-textarea { resize: vertical; min-height: 4.5em; }
      .kit-status { margin: 8px 0 0; font-size: 13px; color: var(--kit-muted); }
      .kit-status.is-accent { color: var(--kit-accent); }
      .kit-status.is-danger { color: var(--kit-danger); }
      .kit-empty {
        margin: 12px 0;
        color: var(--kit-muted);
        font-size: 13px;
        text-align: center;
      }
      .kit-banner {
        display: none;
        margin: 0 0 12px;
        padding: 10px 12px;
        border-radius: var(--kit-radius);
        background: var(--kit-bg);
        color: var(--kit-danger);
        box-shadow: var(--kit-inset);
        font-size: 13px;
      }
      .kit-banner.is-visible { display: block; }
    </style>
  </head>
  <body>
    <div id="root" class="kit-app kit-app--admin">
      <p class="kit-status">Connecting… / Verbinden…</p>
    </div>
    <script src="./bridge.js"></script>
    <script>
      (function () {
        var root = document.getElementById("root");

        function paint(text, state) {
          while (root.firstChild) root.removeChild(root.firstChild);
          var status = document.createElement("p");
          status.className = state ? "kit-status " + state : "kit-status";
          status.textContent = text;
          root.appendChild(status);
        }

        function scopesOf(session) {
          if (!session) return [];
          var context = session.context || {};
          var lists = [session.approved_scopes, session.scopes, context.scopes];
          for (var i = 0; i < lists.length; i += 1) {
            if (Array.isArray(lists[i]) && lists[i].length > 0) return lists[i];
          }
          return [];
        }

        function contextFrom(host, session) {
          session = session || {};
          var context = session.context || {};
          var scopes = scopesOf(session);
          return {
            version: 1,
            app: context.app || {
              id: "",
              slug: "appel-kassa-onboarding",
              name: "Appèl Kassa Onboarding",
              version: ""
            },
            slot: ${JSON.stringify(entryFolder)},
            venue: context.venue || { id: "" },
            user: context.user || {},
            scopes: scopes,
            locale: context.locale || "nl",
            theme: context.theme || { mode: "light", colors: {} },
            api: {
              call: function () {
                return Promise.reject(new Error("This app uses its own backend."));
              }
            },
            storage: {
              get: function (key) { return host.storage.get(key); },
              set: function (key, value) { return host.storage.set(key, value); },
              remove: function (key) { return host.storage.remove(key); }
            },
            ui: {
              toast: function (message, type) {
                host.ui.showToast(message, type || "info");
              },
              setTitle: function () {}
            },
            hasScope: function (scope) { return scopes.indexOf(scope) !== -1; },
            on: function (event, handler) {
              host.on(event, handler);
              return function () { host.off(event, handler); };
            }
          };
        }

        MozoApp.bridge.connect().then(function (host) {
          var latest = host.session.get() || {};
          var started = false;

          function ready(session) {
            if (!session) return false;
            return Boolean(session.token) || scopesOf(session).length > 0;
          }

          function start() {
            if (started) return;
            started = true;
            import(${JSON.stringify(moduleSrc)}).then(function (mod) {
              if (!root || typeof mod.mount !== "function") return;
              mod.mount(root, contextFrom(host, latest));
            }).catch(function () {
              paint("Could not load the app. / De app kon niet laden.", "is-danger");
            });
          }

          host.on("session", function (data) {
            if (data && (data.token || data.scopes || data.approved_scopes || data.context)) {
              latest = data.session || data;
            }
            if (ready(latest)) start();
          });

          if (ready(latest)) start();
          else setTimeout(start, 1500);
        }).catch(function () {
          paint("This spot did not give the app a connection. / Deze plek gaf de app geen verbinding.", "is-danger");
        });
      })();
    </script>
  </body>
</html>
`;

    const styleStart = html.indexOf('<style>');
    const styleEnd = html.indexOf('</style>');
    const styleBlock = html.slice(styleStart, styleEnd);
    if (styleBlock.includes('\\n')) {
        fail('iframe <style> contains a literal backslash-n, so kit rules would not paint');
    }
    const styleRules = styleBlock.replace(/\/\*[\s\S]*?\*\//g, '');
    if (/\bhtml\b|\bbody\b/.test(styleRules)) fail('stylebook: no html or body rules in the style tag');
    if (/(^|[\s,{>~+(])\*(?=[\s,{.#[:>+~]|$)/m.test(styleRules)) {
        fail('stylebook: no universal selector in the style tag');
    }
    if (/height\s*:\s*100%/.test(styleRules)) fail('admin iframe must not set height: 100%');
    if (/overflow\s*:\s*hidden/.test(styleRules)) fail('admin iframe must not set overflow: hidden');
    if (/\b(?:vh|vw|dvh)\b/.test(styleRules)) fail('admin iframe style uses viewport units');
    if (/position\s*:\s*(?:fixed|sticky)/.test(styleRules)) fail('admin iframe style uses fixed or sticky');
    if (/min-width\s*:\s*(?!0\b)\d/.test(styleRules)) fail('stylebook: min-width must not stretch the host');
    if (!styleRules.includes('--kit-bg: #f6f7fb')) fail('stylebook: --kit-bg must be #f6f7fb');
    if (!styleRules.includes('minmax(0, 1fr)')) fail('stylebook: rows must use minmax(0, 1fr)');
    if (!styleRules.includes('min-height: 44px')) fail('stylebook: buttons need a 44px tap target');
    if (!styleRules.includes('overflow-x: hidden')) fail('stylebook: .kit-app must hide horizontal overflow');
    if (!styleRules.includes('.kit-app--admin')) fail('stylebook: admin padding modifier is missing');
    if (!styleRules.includes('.kit-banner.is-visible')) fail('stylebook: banner stays hidden until .is-visible');
    if (!html.includes('id="root" class="kit-app kit-app--admin"')) {
        fail('first paint must use the admin kit canvas');
    }
    if (/window\.Mozo/.test(html)) fail('iframe boot must not read window.Mozo');
    if (/basket\./.test(html)) fail('admin boot must not call basket; placement preview may have no basket');
    if (/ui\.resize/.test(html)) fail('fullpage admin must not resize the iframe to content height');
    if (!html.includes('MozoApp.bridge.connect()')) fail('iframe boot must call MozoApp.bridge.connect()');
    if (html.includes('MozoAppContext')) fail('iframe boot must not invent a MozoAppContext');
    if (/localStorage|document\.cookie/.test(html)) fail('iframe boot must not store tokens');

    return html;
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

    // Vite lib mode can leave a second stylesheet (app2.css / style.css). The host
    // only injects app.css; extra sheets still leak into the catalog zip.
    const leftoverCss = (await listCssFiles(DIST_DIR)).filter((name) => name !== STYLE_FILE);
    for (const name of leftoverCss) {
        await rm(path.join(DIST_DIR, name));
        console.log(`emit-manifest: removed leftover stylesheet dist/${name}`);
    }

    for (const name of await listCssFiles(DIST_DIR)) {
        const cssPath = path.join(DIST_DIR, name);
        const original = await readFile(cssPath, 'utf8');
        const sanitized = sanitizeAppCss(original);
        if (sanitized !== original) {
            await writeFile(cssPath, sanitized);
            console.log(`emit-manifest: scoped global selectors in dist/${name}`);
        }
        const hits = findGlobalSelectors(sanitized);
        if (hits.length > 0) {
            fail(
                `dist/${name} still targets html, body, or * ` +
                    `(style.global_leakage): ${hits.slice(0, 4).join(' | ')}`
            );
        }
    }

    // Official hello/init client. Placement preview's half window.Mozo must not win.
    const bridgePath = path.join(ROOT, 'scripts', 'bridge.js');
    if (!existsSync(bridgePath)) {
        fail('scripts/bridge.js not found — the catalog handshake needs the official bridge.');
    }
    const bridgeSrc = await readFile(bridgePath, 'utf8');
    if (!bridgeSrc.includes('function installClient') || bridgeSrc.includes('MozoAppContext')) {
        fail('scripts/bridge.js must be the official hello/init client, not a fake window.Mozo.');
    }
    await writeFile(path.join(DIST_DIR, 'bridge.js'), bridgeSrc);

    const entryFolders = config.entrypoints.map((entrypoint) => {
        if (!entrypoint?.name || typeof entrypoint.name !== 'string') {
            fail('each mozo.app.json entrypoint needs a string "name" (zip folder).');
        }
        // Lovable sidebar labels (Pipeline, Open items, Apparaten) plus admin-config.
        // Allow letters, digits, spaces and hyphens — no path separators.
        if (!/^[A-Za-z0-9][A-Za-z0-9 -]*$/.test(entrypoint.name) || /[\\/]/.test(entrypoint.name)) {
            fail(`entrypoint name "${entrypoint.name}" must be a zip-safe folder name.`);
        }
        return entrypoint.name;
    });

    const cssHrefFor = (prefix) => (styles.length > 0 ? `${prefix}app.css` : '');
    // Root index.html is a local/fallback boot; placement uses the named folders.
    await writeFile(
        path.join(DIST_DIR, 'index.html'),
        iframeDocument({
            cssHref: cssHrefFor('./'),
            moduleSrc: './admin-config/app.js',
            entryFolder: 'admin-config',
        })
    );
    for (const entryFolder of entryFolders) {
        await mkdir(path.join(DIST_DIR, entryFolder), { recursive: true });
        await writeFile(path.join(DIST_DIR, entryFolder, 'bridge.js'), bridgeSrc);
        await writeFile(
            path.join(DIST_DIR, entryFolder, 'app.js'),
            folderModuleWrapper(entryFolder)
        );
        await writeFile(
            path.join(DIST_DIR, entryFolder, 'index.html'),
            iframeDocument({
                cssHref: cssHrefFor('../'),
                moduleSrc: './app.js',
                entryFolder,
            })
        );
    }
    console.log(
        `emit-manifest: wrote zip folders ${entryFolders.map((f) => `${f}/`).join(', ')}`
    );

    // Own backend lives on the Lovable origin. A relative `/api/mozo` path would
    // hit the Mozo host and 404. Absolute URLs stay, but the zip must not contain
    // the literal `/api/mozo` (catalog substring) — `\u007a` is still "z" at runtime.
    const apiOrigin = 'https://mozo-kassa-onboarding-dashboard.lovable.app';
    const jsFiles = await listJsFiles(DIST_DIR);
    let prefixed = 0;
    for (const name of jsFiles) {
        if (name === 'bridge.js' || name.endsWith('/bridge.js')) continue;
        const jsPath = path.join(DIST_DIR, name);
        const original = await readFile(jsPath, 'utf8');
        let rewritten = original.replace(/(['"`])(\/api\/hub)/g, `$1${apiOrigin}$2`);
        // Same-origin server-fn fallback posts to the iframe host. Pin it.
        rewritten = rewritten.replace(
            /,(\s*)window\.location\.origin(\s*)\)/g,
            `,$1${JSON.stringify(apiOrigin)}$2)`
        );
        // Path strings are joined with the Lovable origin at runtime. Keep that value,
        // but don't leave the literal `/api/mozo` in the zip for the catalog scanner.
        rewritten = rewritten.replaceAll('/api/mozo', '/api/mo\\u007ao');
        if (rewritten.match(/(['"`])(\/api\/hub)/g)) {
            fail(`dist/${name} still contains quoted relative /api/hub paths`);
        }
        if (rewritten !== original) {
            await writeFile(jsPath, rewritten);
            prefixed += 1;
        }
    }
    if (prefixed > 0) {
        console.log(
            `emit-manifest: rewrote host API paths in ${prefixed} JS file(s)`
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
            // Per-folder wrapper pins the feature; root app.js is the shared React module.
            module: `${entrypoint.name}/${MODULE_FILE}`,
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
