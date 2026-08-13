# Mozo App Store Boilerplate

Turns a [Lovable](https://lovable.dev) app (or any Vite/React project) into a Mozo App
Store **module bundle** — a self-contained ES module the Mozo dashboard imports and
mounts in-process.

```
1. Create app in Lovable
2. Sync to GitHub
3. This repo clones/checks out that repository
4. wrap-lovable.mjs copies the app into the boilerplate
5. The boilerplate adds manifest.json, mount()/unmount(), app context, lifecycle, build config
6. vite build
7. Output: app.js, app.css, manifest.json, assets/
8. The GitHub Action uploads the bundle to the Mozo App Store
9. The Mozo dashboard downloads and mounts it
```

## Quick start

1. **Use this template** to create your app's repository (or add it to the repo Lovable
   syncs to).
2. Edit [`mozo.app.json`](./mozo.app.json) — the app's name, slug, version, entry points
   and scopes.
3. In the Mozo developer portal, open your app → **Bundle** → **Build tokens**, issue a
   token, and add it to the repository as the secret `MOZO_BUILD_TOKEN`.
4. Push. The [workflow](./.github/workflows/mozo-build.yml) builds and publishes on every
   push to `main`.

### Building locally

```bash
npm install
npm run wrap -- --source ../my-lovable-app   # step 4
npx vite build                               # step 6
node scripts/emit-manifest.mjs               # step 7
node scripts/package-bundle.mjs              # produces bundle.zip
```

Then upload `bundle.zip` from the developer portal, or with a build token:

```bash
curl -X POST "$MOZO_API_BASE_URL/v4/app-store/app/ci/bundle" \
  -H "Authorization: Bearer $MOZO_BUILD_TOKEN" \
  -F "bundle=@bundle.zip;type=application/zip"
```

## Repository configuration

| Kind | Name | Purpose |
| --- | --- | --- |
| Secret | `MOZO_BUILD_TOKEN` | **Required.** Issued in the developer portal; scoped to one app. |
| Secret | `LOVABLE_REPO_TOKEN` | Only when the Lovable app lives in a *private* separate repository. |
| Variable | `MOZO_API_BASE_URL` | Defaults to production (`https://apiv2.themozo.app`). Set it to `https://testapiv2.themozo.net` to publish to test. |
| Variable | `LOVABLE_REPOSITORY` | `owner/name` when the Lovable app is a separate repository. Leave unset when the app lives in this repo. |

## Writing the app

Your Lovable app stays a normal React app. Its default-exported root component (`src/App.tsx`)
is what gets mounted — the boilerplate ignores `src/main.tsx`, because that is the
standalone shell that would fight the host for the page.

To reach Mozo data, use `useMozo()`:

```tsx
import { useMozo } from '@mozo/app';

export default function App() {
  const mozo = useMozo();

  if (!mozo.hasScope('orders:read')) {
    return <p>This app needs the orders:read scope.</p>;
  }

  const load = async () => {
    const orders = await mozo.api.orders.list({ limit: 10 });
    mozo.ui.toast(`Loaded ${orders.length} orders`);
  };

  return <button onClick={load}>Load orders for {mozo.venue.name}</button>;
}
```

The context is documented in [`src/types.ts`](./src/types.ts). Everything the app is
allowed to do goes through it, and the host checks the app's approved scopes on every
call — requesting a scope in `mozo.app.json` is not the same as having been granted it,
so always branch on `hasScope()`.

For work that is not tied to rendering (timers, subscriptions), register it so the host
can tear it down:

```ts
import { onMount } from '@mozo/app';

onMount((mozo) => {
  const id = setInterval(() => refresh(mozo), 30_000);
  return () => clearInterval(id);   // runs on unmount()
});
```

## The contract

The build emits a module exporting exactly two functions:

```ts
export async function mount(element: HTMLElement, context: MozoAppContext): Promise<void>
export async function unmount(): Promise<void>
```

The host may mount and unmount the same app repeatedly (route changes, venue switches),
so `unmount()` must leave the element empty and release everything `mount()` created.
The boilerplate handles this for you; it is only a concern if you replace `src/main.tsx`.

## Build output

```
dist/
├── app.js          the ES module — mount()/unmount()
├── app.css         styles, injected by the host before mount()
├── manifest.json   what the App Store reads to register entry points
└── assets/         fonts, images, anything Vite emitted
```

`manifest.json` may only reference files that exist in the bundle — the API rejects a
manifest pointing at a missing file, so a broken entry point can never be published.

## Constraints

- Bundles are limited to 500 files and 25 MB uncompressed.
- Executables, shell scripts, `.env` files and other non-web assets are rejected.
- `eval()`, `new Function()` and remote `<script src="https://…">` are rejected by the
  bundle scanner. Standard Vite/React output does not use them, but a dependency that
  does will fail the upload.
- React is bundled, not shared with the host — two apps on one page stay independent.
