import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { MozoProvider } from './MozoProvider';
import { clearContext, normalizeContext } from './context';
import { runCleanups, runMountHooks } from './lifecycle';
import type { MozoAppContext } from './types';

// The Lovable app is copied into app/ by scripts/wrap-lovable.mjs, which also writes
// app/entry.ts re-exporting the app's root component as the default export.
import App from '../app/entry';

export type { MozoAppContext } from './types';
export { useMozoContext } from './context';
export { onMount, onUnmount } from './lifecycle';
export { useMozo } from './MozoProvider';

let root: Root | null = null;
let mountedElement: HTMLElement | null = null;

/**
 * Render the app into the host-provided element.
 *
 * The host calls this once per placement. It may call `unmount()` and `mount()` again on
 * the same element (route changes, venue switches), so mounting must be idempotent:
 * mounting over a live root tears the old one down first rather than stacking two React
 * trees on one node.
 */
export async function mount(element: HTMLElement, rawContext: unknown): Promise<void> {
    if (root) {
        await unmount();
    }

    const context: MozoAppContext = normalizeContext(rawContext);

    await runMountHooks(context);

    mountedElement = element;
    root = createRoot(element);
    root.render(
        <React.StrictMode>
            <MozoProvider context={context}>
                <App />
            </MozoProvider>
        </React.StrictMode>
    );
}

/**
 * Tear the app down. The host may reuse the element immediately afterwards, so this
 * must leave it empty and must not throw — a failing unmount would strand host UI.
 */
export async function unmount(): Promise<void> {
    runCleanups();

    if (root) {
        try {
            root.unmount();
        } catch (error) {
            console.error('[mozo-app] React unmount failed:', error);
        }
        root = null;
    }

    if (mountedElement) {
        mountedElement.innerHTML = '';
        mountedElement = null;
    }

    clearContext();
}
